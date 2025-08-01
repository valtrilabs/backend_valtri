require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://frontend-valtri.vercel.app',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error(`CORS blocked for origin: ${origin}`);
      callback(new Error(`CORS policy: Origin ${origin} not allowed`));
    }
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Waiter-Auth'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Middleware
app.use(express.json());

// Prevent caching of API responses
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.on('finish', () => {
    console.log(`Response headers for ${req.method} ${req.url}:`, res.getHeaders());
  });
  next();
});

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - Body:`, req.body, 'Query:', req.query, 'Headers:', req.headers);
  next();
});

// Validate location endpoint
app.post('/api/validate-location', async (req, res) => {
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    console.log('POST /api/validate-location - Missing coordinates');
    return res.status(400).json({ error: 'Latitude and longitude are required' });
  }

  try {
    const { data: settings, error: settingsError } = await supabase
      .from('cafe_settings')
      .select('latitude, longitude, geofence_radius_meters')
      .single();

    if (settingsError || !settings) {
      console.log('POST /api/validate-location - Cafe settings not found:', settingsError?.message);
      return res.status(500).json({ error: 'Cafe settings not configured' });
    }

    // Calculate distance using Haversine formula (in meters)
    const distance = calculateDistance(
      latitude,
      longitude,
      settings.latitude,
      settings.longitude
    );

    const isValid = distance <= settings.geofence_radius_meters;
    res.json({ isValid });
  } catch (error) {
    console.error('POST /api/validate-location - Error:', error);
    res.status(500).json({ error: `Failed to validate location: ${error.message}` });
  }
});

// Haversine formula to calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test Supabase connectivity
app.get('/api/test-supabase', async (req, res) => {
  try {
    const { data, error } = await supabase.from('menu_items').select('id').limit(1);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error('Supabase test error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get menu items
app.get('/api/menu', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, category, price, description, image_url')
      .eq('is_available', true)
      .order('category, name');
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('GET /api/menu - Error:', error);
    res.status(500).json({ error: `Failed to fetch menu: ${error.message}` });
  }
});

// Create order
app.post('/api/orders', async (req, res) => {
  const { table_id, items, notes, latitude, longitude } = req.body;
  const isWaiterRequest = req.headers['x-waiter-auth'] === 'true';

  if (!table_id || !items || !Array.isArray(items)) {
    console.log('POST /api/orders - Invalid input');
    return res.status(400).json({ error: 'Table ID and items array are required' });
  }

  try {
    // Validate location for non-waiter requests
    if (!isWaiterRequest) {
      if (!latitude || !longitude) {
        console.log('POST /api/orders - Missing coordinates for non-waiter request');
        return res.status(400).json({ error: 'Latitude and longitude are required for customer orders' });
      }

      const { data: settings, error: settingsError } = await supabase
        .from('cafe_settings')
        .select('latitude, longitude, geofence_radius_meters')
        .single();

      if (settingsError || !settings) {
        console.log('POST /api/orders - Cafe settings not found:', settingsError?.message);
        return res.status(500).json({ error: 'Cafe settings not configured' });
      }

      const distance = calculateDistance(latitude, longitude, settings.latitude, settings.longitude);
      if (distance > settings.geofence_radius_meters) {
        console.log('POST /api/orders - Location outside geofence');
        return res.status(403).json({ error: 'Orders can only be placed from within the cafe' });
      }
    }

    // Validate table_id
    const { data: table, error: tableError } = await supabase
      .from('tables')
      .select('id')
      .eq('id', table_id)
      .single();
    if (tableError || !table) {
      console.log('POST /api/orders - Invalid table:', tableError?.message);
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    // Validate items
    const itemIds = items.map(item => item.item_id).filter(id => id);
    if (itemIds.length !== items.length) {
      console.log('POST /api/orders - Missing item IDs');
      return res.status(400).json({ error: 'All items must have valid item IDs' });
    }
    const { data: menuItems, error: itemsError } = await supabase
      .from('menu_items')
      .select('id')
      .in('id', itemIds);
    if (itemsError || menuItems.length !== itemIds.length) {
      console.log('POST /api/orders - Invalid items:', itemsError?.message);
      return res.status(400).json({ error: 'One or more items are invalid' });
    }

    const validItems = items.map(item => ({
      item_id: item.item_id,
      name: item.name || 'Unknown',
      price: parseFloat(item.price) || 0,
      quantity: parseInt(item.quantity) || 1,
      category: item.category || '',
      note: item.note || ''
    }));

    const { data, error } = await supabase
      .from('orders')
      .insert([{ table_id, items: validItems, status: 'pending', notes: notes || null }])
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type')
      .single();
    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('POST /api/orders - Error:', error);
    res.status(500).json({ error: `Failed to create order: ${error.message}` });
  }
});

// Update order items
app.patch('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { items, notes } = req.body;
  const isWaiterRequest = req.headers['x-waiter-auth'] === 'true';

  if (!items || !Array.isArray(items)) {
    console.log('PATCH /api/orders/:id - Invalid input');
    return res.status(400).json({ error: 'Non-empty items array is required' });
  }

  try {
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
    const itemIds = items.map(item => item.item_id).filter(id => id);
    if (itemIds.length !== items.length) {
      console.log('PATCH /api/orders/:id - Missing item IDs');
      return res.status(400).json({ error: 'All items must have valid item IDs' });
    }
    const { data: menuItems, error: itemsError } = await supabase
      .from('menu_items')
      .select('id')
      .in('id', itemIds);
    if (itemsError || menuItems.length !== itemIds.length) {
      console.log('PATCH /api/orders/:id - Invalid items:', itemsError?.message);
      return res.status(400).json({ error: 'One or more items are invalid' });
    }

    const validItems = items.map(item => ({
      item_id: item.item_id,
      name: item.name || 'Unknown',
      price: parseFloat(item.price) || 0,
      quantity: parseInt(item.quantity) || 1,
      category: item.category || '',
      note: item.note || ''
    }));

    const { data, error } = await supabase
      .from('orders')
      .update({ items: validItems, notes: notes || null })
      .eq('id', id)
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type')
      .single();
    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('PATCH /api/orders/:id - Error:', error);
    res.status(500).json({ error: `Failed to update order: ${error.message}` });
  }
});

// Get order by ID
app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
      .eq('id', id)
      .single();
    if (error) throw error;
    if (!data) {
      console.log('GET /api/orders/:id - Order not found');
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(data);
  } catch (error) {
    console.error('GET /api/orders/:id - Error:', error);
    res.status(500).json({ error: `Failed to fetch order: ${error.message}` });
  }
});

// Mark order as paid
app.patch('/api/orders/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { payment_type } = req.body;
  if (!payment_type || !['UPI', 'Cash', 'Bank', 'Card'].includes(payment_type)) {
    console.log('PATCH /api/orders/:id/pay - Invalid payment type');
    return res.status(400).json({ error: 'Valid payment type is required (UPI, Cash, Bank, Card)' });
  }

  try {
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id')
      .eq('id', id)
      .single();
    if (orderError || !order) {
      console.log('PATCH /api/orders/:id/pay - Order not found:', orderError?.message);
      return res.status(404).json({ error: 'Order not found' });
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'paid', payment_type })
      .eq('id', id)
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type')
      .single();
    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('PATCH /api/orders/:id/pay - Error:', error);
    res.status(500).json({ error: `Failed to mark order as paid: ${error.message}` });
  }
});

// Get pending orders (admin)
app.get('/api/admin/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('GET /api/admin/orders - Error:', error);
    res.status(500).json({ error: `Failed to fetch pending orders: ${error.message}` });
  }
});

// Get order history (admin)
app.get('/api/admin/orders/history', async (req, res) => {
  const { startDate, endDate, statuses, search, aggregate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
      .order('created_at', { ascending: false });

    // Date range filter (treat as IST)
    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    // Status filter
    if (statuses) {
      const statusArray = statuses.split(',').map(s => s.trim());
      query = query.in('status', statusArray);
    }

    // Search by order_number or table number
    if (search) {
      const sanitizedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query = query.or(`order_number.ilike.%${sanitizedSearch}%,tables.number.ilike.%${sanitizedSearch}%`);
    }

    // Handle aggregations
    if (aggregate) {
      const { data, error } = await query;
      if (error) throw error;

      if (aggregate === 'revenue') {
        const totalRevenue = data.reduce((sum, order) => {
          if (!Array.isArray(order.items)) {
            console.warn(`Order ${order.id} has invalid items: ${order.items}`);
            return sum;
          }
          return sum + order.items.reduce((s, item) => s + (item.price || 0) * (item.quantity || 1), 0);
        }, 0);
        return res.json({ totalRevenue });
      }
      if (aggregate === 'items_sold') {
        const totalItemsSold = data.reduce((sum, order) => {
          if (!Array.isArray(order.items)) {
            console.warn(`Order ${order.id} has invalid items: ${order.items}`);
            return sum;
          }
          return sum + order.items.reduce((s, item) => s + (item.quantity || 1), 0);
        }, 0);
        return res.json({ totalItemsSold });
      }
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('GET /api/admin/orders/history - Error:', error);
    res.status(500).json({ error: `Failed to fetch order history: ${error.message}` });
  }
});

// Get pending orders (waiter)
app.get('/api/orders', async (req, res) => {
  const { status } = req.query;
  if (status !== 'pending') {
    console.log('GET /api/orders - Invalid status');
    return res.status(400).json({ error: 'Only pending status is supported' });
  }

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('GET /api/orders - Error:', error);
    res.status(500).json({ error: `Failed to fetch pending orders: ${error.message}` });
  }
});

// Export orders as CSV (admin)
app.get('/api/admin/orders/export', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const csv = [
      'Order Number,Table Number,Items,Status,Notes,Created At,Payment Method',
      ...data.map(order =>
        `"${order.order_number || order.id}","${order.tables?.number || 'N/A'}","${JSON.stringify(order.items || []).replace(/"/g, '""')}","${order.status || 'N/A'}","${order.notes || ''}","${order.created_at || ''}","${order.payment_type || ''}"`
      ),
    ].join('\n');

    res.header('Content-Type', 'text/csv');
    res.attachment('orders.csv');
    res.send(csv);
  } catch (error) {
    console.error('GET /api/admin/orders/export - Error:', error);
    res.status(500).json({ error: `Failed to export orders: ${error.message}` });
  }
});

// Analytics: Total Orders
app.get('/api/admin/analytics/total-orders', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('id', { count: 'exact' })
      .eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { count, error } = await query;
    if (error) throw error;

    res.json({ totalOrders: count || 0 });
  } catch (error) {
    console.error('GET /api/admin/analytics/total-orders - Error:', error);
    res.status(500).json({ error: `Failed to fetch total orders: ${error.message}` });
  }
});

// Analytics: Total Revenue
app.get('/api/admin/analytics/total-revenue', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('items')
      .eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const totalRevenue = data.reduce((sum, order) => {
      if (!Array.isArray(order.items)) {
        console.warn(`Order with invalid items: ${order.items}`);
        return sum;
      }
      return sum + order.items.reduce((s, item) => s + (item.price || 0) * (item.quantity || 1), 0);
    }, 0);

    res.json({ totalRevenue: totalRevenue || 0 });
  } catch (error) {
    console.error('GET /api/admin/analytics/total-revenue - Error:', error);
    res.status(500).json({ error: `Failed to fetch total revenue: ${error.message}` });
  }
});

// Analytics: Most Sold Item
app.get('/api/admin/analytics/most-sold-item', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('items')
      .eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const itemCounts = {};
    data.forEach(order => {
      if (!Array.isArray(order.items)) {
        console.warn(`Order with invalid items: ${order.items}`);
        return;
      }
      order.items.forEach(item => {
        const name = item.name || 'Unknown';
        itemCounts[name] = (itemCounts[name] || 0) + (item.quantity || 1);
      });
    });

    const mostSold = Object.entries(itemCounts).reduce(
      (max, [name, totalSold]) => totalSold > (max.totalSold || 0) ? { name, totalSold } : max,
      { name: 'N/A', totalSold: 0 }
    );

    res.json(mostSold);
  } catch (error) {
    console.error('GET /api/admin/analytics/most-sold-item - Error:', error);
    res.status(500).json({ error: `Failed to fetch most sold item: ${error.message}` });
  }
});

// Analytics: Peak Hours
app.get('/api/admin/analytics/peak-hours', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('created_at')
      .eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const ordersByHour = Array(24).fill(0);
    data.forEach(order => {
      if (!order.created_at) return;
      const hour = new Date(order.created_at).getHours();
      ordersByHour[hour]++;
    });

    const peakHourIndex = ordersByHour.reduce((maxIdx, count, idx, arr) => count > arr[maxIdx] ? idx : maxIdx, 0);
    const peakHour = ordersByHour[peakHourIndex] > 0 ? `${peakHourIndex}:00-${peakHourIndex + 1}:00` : 'N/A';

    res.json({ peakHour });
  } catch (error) {
    console.error('GET /api/admin/analytics/peak-hours - Error:', error);
    res.status(500).json({ error: `Failed to fetch peak hours: ${error.message}` });
  }
});

// Analytics: Average Order Value
app.get('/api/admin/analytics/average-order-value', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('items')
      .eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data.length) return res.json({ aov: 0 });

    const totalRevenue = data.reduce((sum, order) => {
      if (!Array.isArray(order.items)) {
        console.warn(`Order with invalid items: ${order.items}`);
        return sum;
      }
      return sum + order.items.reduce((s, item) => s + (item.price || 0) * (item.quantity || 1), 0);
    }, 0);
    const aov = totalRevenue / data.length;

    res.json({ aov: aov || 0 });
  } catch (error) {
    console.error('GET /api/admin/analytics/average-order-value - Error:', error);
    res.status(500).json({ error: `Failed to fetch average order value: ${error.message}` });
  }
});

// Analytics: Total Items Sold
app.get('/api/admin/analytics/total-items-sold', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('items')
      .eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const totalItemsSold = data.reduce((sum, order) => {
      if (!Array.isArray(order.items)) {
        console.warn(`Order with invalid items: ${order.items}`);
        return sum;
      }
      return sum + order.items.reduce((s, item) => s + (item.quantity || 1), 0);
    }, 0);

    res.json({ totalItemsSold: totalItemsSold || 0 });
  } catch (error) {
    console.error('GET /api/admin/analytics/total-items-sold - Error:', error);
    res.status(500).json({ error: `Failed to fetch total items sold: ${error.message}` });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

//redeploy trigger