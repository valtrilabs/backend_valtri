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
app.options('*', cors(corsOptions)); // Handle preflight requests
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
    .select('id, name, category, price, description')
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
    .select('id, order_number, created_at, table_id, items, status, notes')
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

  // Validate items
  const { data: menuItems, error: itemsError } = await supabase
    .from('menu_items')
    .select('id')
    .in('id', items.map(item => item.item_id));
  if (itemsError || menuItems.length !== items.length) {
    console.log('PATCH /api/orders/:id - Invalid items:', itemsError?.message);
    return res.status(400).json({ error: 'Invalid items' });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ items, notes: notes || null })
    .eq('id', id)
    .select('id, order_number, created_at, table_id, items, status, notes')
    .single();
  if (error) {
    console.error('PATCH /api/orders/:id - Order update error:', error);
    return res.status(500).json({ error: error.message });
  }
  console.log('PATCH /api/orders/:id - Order updated:', data);
  res.json(data);
});

// Get order by ID
app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, created_at, table_id, items, status, notes, tables(number)')
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
    .update({ status: 'paid' })
    .eq('id', id)
    .select('id, order_number, created_at, table_id, items, status, notes')
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
    .select('id, order_number, created_at, table_id, items, status, notes, tables(number)')
    .eq('status', 'pending');
  if (error) {
    console.error('GET /api/admin/orders - Pending orders fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Get order history (admin)
app.get('/api/admin/orders/history', async (req, res) => {
  const { startDate, endDate, statuses, search } = req.query;
  console.log('GET /api/admin/orders/history - Query:', { startDate, endDate, statuses, search });

  let query = supabase
    .from('orders')
    .select('id, order_number, created_at, table_id, items, status, notes, tables(number)')
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
    // Sanitize search input by escaping special characters
    const sanitizedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    query = query.or(`order_number.ilike.%${sanitizedSearch}%,tables.number.ilike.%${sanitizedSearch}%`);
  }

  const { data, error } = await query;
  if (error) {
    console.error('GET /api/admin/orders/history - History fetch error:', error);
    return res.status(500).json({ error: error.message });
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
    .select('id, order_number, created_at, table_id, items, status, notes, tables(number)')
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
    .select('id, order_number, created_at, table_id, items, status, notes, tables(number)')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('GET /api/admin/orders/export - Orders export error:', error);
    return res.status(500).json({ error: error.message });
  }

  const csv = [
    'Order Number,Table Number,Items,Status,Notes,Created At',
    ...data.map(order =>
      `${order.order_number || order.id},${order.tables.number},${JSON.stringify(order.items)},${order.status},${order.notes || ''},${order.created_at}`
    ),
  ].join('\n');

  res.header('Content-Type', 'text/csv');
  res.attachment('orders.csv');
  res.send(csv);
});

// Start server
app.listen(port, () => {
  console.log(`Backend running on port ${port}`);
});