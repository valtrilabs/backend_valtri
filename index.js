require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3001;

// CORS configuration
const corsOptions = {
  origin: ['https://frontend-kappa-blush-17.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Get menu items
app.get('/api/menu', async (req, res) => {
  const { data, error } = await supabase
    .from('menu_items')
    .select('id, name, category, price, description, image_url')
    .eq('is_available', true)
    .order('category, name');
  if (error) {
    console.error('Menu fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Create order
app.post('/api/orders', async (req, res) => {
  const { table_id, items, notes } = req.body;
  console.log('POST /api/orders - Payload:', { table_id, items, notes });
  if (!table_id || !items || !Array.isArray(items)) {
    console.log('POST /api/orders - Invalid input');
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Validate table_id
  const { data: table, error: tableError } = await supabase
    .from('tables')
    .select('id')
    .eq('id', table_id)
    .single();
  if (tableError || !table) {
    console.log('POST /api/orders - Invalid table:', tableError?.message);
    return res.status(400).json({ error: 'Invalid table' });
  }

  // Validate items
  const { data: menuItems, error: itemsError } = await supabase
    .from('menu_items')
    .select('id')
    .in('id', items.map(item => item.item_id));
  if (itemsError || menuItems.length !== items.length) {
    console.log('POST /api/orders - Invalid items:', itemsError?.message);
    return res.status(400).json({ error: 'Invalid items' });
  }

  const { data, error } = await supabase
    .from('orders')
    .insert([{ table_id, items, status: 'pending', notes: notes || null }])
    .select('id, order_number, created_at, table_id, items, status, notes, payment_type')
    .single();
  if (error) {
    console.error('POST /api/orders - Order insert error:', error);
    return res.status(500).json({ error: error.message });
  }
  console.log('POST /api/orders - Order created:', data);
  res.json(data);
});

// Update order items
app.patch('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { items, notes } = req.body;
  console.log('PATCH /api/orders/:id - Payload:', { id, items, notes });
  if (!items || !Array.isArray(items)) {
    console.log('PATCH /api/orders/:id - Invalid input');
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Check if order exists and is pending
  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('status')
    .eq('id', id)
    .single();
  if (orderError || !order) {
    console.log('PATCH /api/orders/:id - Order not found:', orderError?.message);
    return res.status(404).json({ error: 'Order not found' });
  }
  if (order.status !== 'pending') {
    console.log('PATCH /api/orders/:id - Can only update pending orders');
    return res.status(400).json({ error: 'Can only update pending orders' });
  }

  // Fetch menu items to validate and normalize
  const itemIds = items.map(item => item.item_id);
  const { data: menuItems, error: itemsError } = await supabase
    .from('menu_items')
    .select('id, name, price, category, image_url')
    .in('id', itemIds);
  if (itemsError) {
    console.log('PATCH /api/orders/:id - Menu items fetch error:', itemsError.message);
    return res.status(500).json({ error: 'Failed to validate items' });
  }
  if (menuItems.length !== items.length) {
    console.log('PATCH /api/orders/:id - Invalid items: Some item IDs not found');
    return res.status(400).json({ error: 'Invalid items' });
  }

  // Normalize items
  const normalizedItems = items.map(item => {
    const menuItem = menuItems.find(mi => mi.id === item.item_id);
    if (!menuItem) {
      return null;
    }
    return {
      item_id: item.item_id,
      name: menuItem.name,
      price: menuItem.price,
      category: menuItem.category || '',
      image_url: menuItem.image_url || '',
      quantity: item.quantity || 1,
      note: item.note || '',
    };
  }).filter(item => item !== null);

  if (normalizedItems.length !== items.length) {
    console.log('PATCH /api/orders/:id - Invalid items: Normalization failed');
    return res.status(400).json({ error: 'Invalid items' });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ items: normalizedItems, notes: notes || null })
    .eq('id', id)
    .select('id, order_number, created_at, table_id, items, status, notes, payment_type')
    .single();
  if (error) {
    console.error('PATCH /api/orders/:id - Order update error:', error);
    return res.status(500).json({ error: `Failed to update order: ${error.message}` });
  }
  console.log('PATCH /api/orders/:id - Order updated:', data);
  res.json(data);
});

// Get order by ID
app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
    .eq('id', id)
    .single();
  if (error) {
    console.error('GET /api/orders/:id - Order fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  if (!data) {
    console.log('GET /api/orders/:id - Order not found');
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json(data);
});

// Mark order as paid
app.patch('/api/orders/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { payment_type } = req.body;
  console.log('PATCH /api/orders/:id/pay - Payload:', { id, payment_type });

  if (!payment_type || !['UPI', 'Cash', 'Bank', 'Card'].includes(payment_type)) {
    console.log('PATCH /api/orders/:id/pay - Invalid payment type');
    return res.status(400).json({ error: 'Valid payment type is required (UPI, Cash, Bank, Card)' });
  }

  const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('id')
    .eq('id', id)
    .single();
  if (orderError || !order) {
    console.error('PATCH /api/orders/:id/pay - Order not found:', orderError?.message);
    return res.status(404).json({ error: 'Order not found' });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'paid', payment_type })
    .eq('id', id)
    .select('id, order_number, created_at, table_id, items, status, notes, payment_type')
    .single();
  if (error) {
    console.error('PATCH /api/orders/:id/pay - Order pay error:', error);
    return res.status(500).json({ error: error.message });
  }
  console.log('PATCH /api/orders/:id/pay - Order marked as paid:', data);
  res.json(data);
});

// Get pending orders (admin)
app.get('/api/admin/orders', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
    .eq('status', 'pending');
  if (error) {
    console.error('GET /api/admin/orders - Pending orders fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Get order history (admin)
app.get('/api/admin/orders/history', async (req, res) => {
  const { startDate, endDate, statuses, search, aggregate } = req.query;
  console.log('GET /api/admin/orders/history - Query:', { startDate, endDate, statuses, search, aggregate });

  let query = supabase
    .from('orders')
    .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
    .order('created_at', { ascending: false });

  // Date range filter
  if (startDate && endDate) {
    query = query
      .gte('created_at', startDate)
      .lte('created_at', endDate);
  }

  // Status filter
  if (statuses) {
    const statusArray = statuses.split(',');
    query = query.in('status', statusArray);
  }

  // Search by order_number or table number
  if (search) {
    const sanitizedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query = query.or(`order_number.ilike.%${sanitizedSearch}%,tables.number.ilike.%${sanitizedSearch}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('GET /api/admin/orders/history - History fetch error:', error);
    return res.status(500).json({ error: error.message });
  }

  // Handle aggregations
  if (aggregate) {
    if (aggregate === 'revenue') {
      const totalRevenue = data.reduce((sum, order) =>
        sum + order.items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0), 0
      );
      return res.json({ totalRevenue });
    }
    if (aggregate === 'items_sold') {
      const totalItemsSold = data.reduce((sum, order) =>
        sum + order.items.reduce((s, item) => s + (item.quantity || 1), 0), 0
      );
      return res.json({ totalItemsSold });
    }
  }

  res.json(data);
});

// Get pending orders (waiter)
app.get('/api/orders', async (req, res) => {
  const { status } = req.query;
  console.log('GET /api/orders - Query:', { status });
  if (status !== 'pending') {
    console.log('GET /api/orders - Invalid status');
    return res.status(400).json({ error: 'Only pending status is supported' });
  }

  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('GET /api/orders - Pending orders fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  console.log('GET /api/orders - Pending orders fetched:', data);
  res.json(data);
});

// Export orders as CSV (admin)
app.get('/api/admin/orders/export', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('GET /api/admin/orders/export - Orders export error:', error);
    return res.status(500).json({ error: error.message });
  }

  const csv = [
    'Order Number,Table Number,Items,Status,Notes,Created At,Payment Method',
    ...data.map(order =>
      `${order.order_number || order.id},${order.tables.number},${JSON.stringify(order.items)},${order.status},${order.notes || ''},${order.created_at},${order.payment_type || ''}`
    ),
  ].join('\n');

  res.header('Content-Type', 'text/csv');
  res.attachment('orders.csv');
  res.send(csv);
});

// New analytics endpoints
app.get('/api/admin/analytics/total-orders', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/total-orders - Query:', { startDate, endDate });

  let query = supabase
    .from('orders')
    .select('id', { count: 'exact' })
    .eq('status', 'paid');

  if (startDate && endDate) {
    query = query
      .gte('created_at', startDate)
      .lte('created_at', endDate);
  } else {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);
    query = query
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());
  }

  const { count, error } = await query;
  if (error) {
    console.error('GET /api/admin/analytics/total-orders - Error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json({ totalOrders: count || 0 });
});

app.get('/api/admin/analytics/total-revenue', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/total-revenue - Query:', { startDate, endDate });

  let query = supabase
    .from('orders')
    .select('items')
    .eq('status', 'paid');

  if (startDate && endDate) {
    query = query
      .gte('created_at', startDate)
      .lte('created_at', endDate);
  } else {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);
    query = query
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error('GET /api/admin/analytics/total-revenue - Error:', error);
    return res.status(500).json({ error: error.message });
  }

  const totalRevenue = data.reduce((sum, order) =>
    sum + order.items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0), 0
  );
  res.json({ totalRevenue: totalRevenue || 0 });
});

app.get('/api/admin/analytics/most-sold-item', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/most-sold-item - Query:', { startDate, endDate });

  let query = supabase
    .from('orders')
    .select('items')
    .eq('status', 'paid');

  if (startDate && endDate) {
    query = query
      .gte('created_at', startDate)
      .lte('created_at', endDate);
  } else {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);
    query = query
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error('GET /api/admin/analytics/most-sold-item - Error:', error);
    return res.status(500).json({ error: error.message });
  }

  const itemCounts = {};
  data.forEach(order => {
    order.items.forEach(item => {
      itemCounts[item.name] = (itemCounts[item.name] || 0) + (item.quantity || 1);
    });
  });

  const mostSold = Object.entries(itemCounts).reduce((max, [name, totalSold]) =>
    totalSold > (max.totalSold || 0) ? { name, totalSold } : max,
    { name: '', totalSold: 0 }
  );

  res.json(mostSold);
});

app.get('/api/admin/analytics/peak-hours', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/peak-hours - Query:', { startDate, endDate });

  let query = supabase
    .from('orders')
    .select('created_at')
    .eq('status', 'paid');

  if (startDate && endDate) {
    query = query
      .gte('created_at', startDate)
      .lte('created_at', endDate);
  } else {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);
    query = query
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error('GET /api/admin/analytics/peak-hours - Error:', error);
    return res.status(500).json({ error: error.message });
  }

  const ordersByHour = Array(24).fill(0);
  data.forEach(order => {
    const istDate = new Date(order.created_at);
    istDate.setHours(istDate.getHours() + 5);
    istDate.setMinutes(istDate.getMinutes() + 30);
    const hour = istDate.getHours();
    ordersByHour[hour]++;
  });

  const peakHourIndex = ordersByHour.indexOf(Math.max(...ordersByHour));
  const peakHour = peakHourIndex === -1 ? 'N/A' : `${peakHourIndex}:00`;

  res.json({ peakHour });
});

app.get('/api/admin/analytics/average-order-value', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/average-order-value - Query:', { startDate, endDate });

  let query = supabase
    .from('orders')
    .select('items')
    .eq('status', 'paid');

  if (startDate && endDate) {
    query = query
      .gte('created_at', startDate)
      .lte('created_at', endDate);
  } else {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);
    query = query
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error('GET /api/admin/analytics/average-order-value - Error:', error);
    return res.status(500).json({ error: error.message });
  }

  const totalRevenue = data.reduce((sum, order) =>
    sum + order.items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0), 0
  );
  const totalOrders = data.length;
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  res.json({ aov });
});

app.get('/api/admin/analytics/total-items-sold', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/total-items-sold - Query:', { startDate, endDate });

  let query = supabase
    .from('orders')
    .select('items')
    .eq('status', 'paid');

  if (startDate && endDate) {
    query = query
      .gte('created_at', startDate)
      .lte('created_at', endDate);
  } else {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setUTCHours(23, 59, 59, 999);
    query = query
      .gte('created_at', todayStart.toISOString())
      .lte('created_at', todayEnd.toISOString());
  }

  const { data, error } = await query;
  if (error) {
    console.error('GET /api/admin/analytics/total-items-sold - Error:', error);
    return res.status(500).json({ error: error.message });
  }

  const totalItemsSold = data.reduce((sum, order) =>
    sum + order.items.reduce((s, item) => s + (item.quantity || 1), 0), 0
  );

  res.json({ totalItemsSold });
});

// Start server
app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});