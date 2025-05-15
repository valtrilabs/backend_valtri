require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
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
  const { table_id, items } = req.body;
  if (!table_id || !items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Validate table_id
  const { data: table } = await supabase
    .from('tables')
    .select('id')
    .eq('id', table_id)
    .single();
  if (!table) return res.status(400).json({ error: 'Invalid table' });

  // Validate items
  const { data: menuItems } = await supabase
    .from('menu_items')
    .select('id')
    .in('id', items.map(item => item.item_id));
  if (menuItems.length !== items.length) {
    return res.status(400).json({ error: 'Invalid items' });
  }

  const { data, error } = await supabase
    .from('orders')
    .insert([{ table_id, items, status: 'pending' }])
    .select()
    .single();
  if (error) {
    console.error('Order insert error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Update order items
app.patch('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Invalid input' });
  }

  // Check if order exists and is pending
  const { data: order } = await supabase
    .from('orders')
    .select('status')
    .eq('id', id)
    .single();
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'pending') {
    return res.status(400).json({ error: 'Can only update pending orders' });
  }

  // Validate items
  const { data: menuItems } = await supabase
    .from('menu_items')
    .select('id')
    .in('id', items.map(item => item.item_id));
  if (menuItems.length !== items.length) {
    return res.status(400).json({ error: 'Invalid items' });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ items })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('Order update error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Get order by ID
app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('orders')
    .select('*, tables(number)')
    .eq('id', id)
    .single();
  if (error) {
    console.error('Order fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  if (!data) return res.status(404).json({ error: 'Order not found' });
  res.json(data);
});

// Mark order as paid (admin only)
app.patch('/api/orders/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { data: order } = await supabase
    .from('orders')
    .select('id')
    .eq('id', id)
    .single();
  if (!order) {
    console.error('Order not found:', id);
    return res.status(404).json({ error: 'Order not found' });
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ status: 'paid' })
    .eq('id', id)
    .select()
    .single();
  if (error) {
    console.error('Order pay error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Get all pending orders (admin)
app.get('/api/admin/orders', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('*, tables(number)')
    .eq('status', 'pending');
  if (error) {
    console.error('Pending orders fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// Export orders as CSV (admin)
app.get('/api/admin/orders/export', async (req, res) => {
  const { data, error } = await supabase
    .from('orders')
    .select('id, table_id, items, status, created_at, tables(number)')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Orders export error:', error);
    return res.status(500).json({ error: error.message });
  }

  const csv = [
    'Order ID,Table Number,Items,Status,Created At',
    ...data.map(order =>
      `${order.id},${order.tables.number},${JSON.stringify(order.items)},${order.status},${order.created_at}`
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