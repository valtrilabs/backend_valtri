const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

const app = express();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

app.use(cors());
app.use(express.json());

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - Body:`, req.body, 'Query:', req.query);
  next();
});

// Fetch menu items
app.get('/api/menu', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('id, name, price, is_available, description, category, image_url')
      .eq('is_available', true);
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('GET /api/menu - Error:', error);
    res.status(500).json({ error: `Failed to fetch menu: ${error.message}` });
  }
});

// Fetch tables
app.get('/api/tables', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tables').select('id, number');
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('GET /api/tables - Error:', error);
    res.status(500).json({ error: `Failed to fetch tables: ${error.message}` });
  }
});

// Create a new order
app.post('/api/orders', async (req, res) => {
  const { table_id, items } = req.body;
  if (!table_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Table ID and non-empty items array are required' });
  }

  try {
    const order_number = `ORD-${Math.floor(1000 + Math.random() * 9000)}`;
    const { data: table, error: tableError } = await supabase
      .from('tables')
      .select('id')
      .eq('id', table_id)
      .single();
    if (tableError || !table) {
      return res.status(400).json({ error: 'Invalid table ID' });
    }

    const validItems = items.map((item) => ({
      item_id: item.item_id,
      name: item.name || 'Unknown',
      price: parseFloat(item.price) || 0,
      quantity: parseInt(item.quantity) || 1,
      category: item.category || '',
      note: item.note || '',
    }));

    const { data, error } = await supabase
      .from('orders')
      .insert([{ id: uuidv4(), table_id, items: validItems, status: 'pending', order_number }])
      .select()
      .single();
    if (error) throw error;

    const { data: orderWithTable, error: fetchError } = await supabase
      .from('orders')
      .select('*, tables(number)')
      .eq('id', data.id)
      .single();
    if (fetchError) throw fetchError;

    res.json(orderWithTable);
  } catch (error) {
    console.error('POST /api/orders - Error:', error);
    res.status(500).json({ error: `Failed to create order: ${error.message}` });
  }
});

// Fetch a single order by ID
app.get('/api/orders/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(number)')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Order not found' });
    res.json(data);
  } catch (error) {
    console.error('GET /api/orders/:id - Error:', error);
    res.status(500).json({ error: `Failed to fetch order: ${error.message}` });
  }
});

// Fetch all pending orders for admin
app.get('/api/admin/orders', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(number)')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('GET /api/admin/orders - Error:', error);
    res.status(500).json({ error: `Failed to fetch orders: ${error.message}` });
  }
});

// Update an order’s items
app.patch('/api/orders/:id', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items must be a non-empty array' });
  }

  try {
    const { data: existingOrder, error: fetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('id', req.params.id)
      .single();
    if (fetchError || !existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const validItems = items.map((item) => ({
      item_id: item.item_id,
      name: item.name || 'Unknown',
      price: parseFloat(item.price) || 0,
      quantity: parseInt(item.quantity) || 1,
      category: item.category || '',
      note: item.note || '',
    }));

    const { data, error } = await supabase
      .from('orders')
      .update({ items: validItems })
      .eq('id', req.params.id)
      .select('*, tables(number)')
      .single();
    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('PATCH /api/orders/:id - Error:', error);
    res.status(500).json({ error: `Failed to update order: ${error.message}` });
  }
});

// Mark an order as paid
app.patch('/api/orders/:id/pay', async (req, res) => {
  const { payment_type } = req.body;
  if (!payment_type) {
    return res.status(400).json({ error: 'Payment type is required' });
  }

  try {
    const { data: existingOrder, error: fetchError } = await supabase
      .from('orders')
      .select('id')
      .eq('id', req.params.id)
      .single();
    if (fetchError || !existingOrder) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'paid', payment_type })
      .eq('id', req.params.id)
      .select('*, tables(number)')
      .single();
    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error('PATCH /api/orders/:id/pay - Error:', error);
    res.status(500).json({ error: `Failed to mark order as paid: ${error.message}` });
  }
});

// Fetch order history with filters
app.get('/api/admin/orders/history', async (req, res) => {
  const { startDate, endDate, statuses, aggregate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('*, tables(number)')
      .order('created_at', { ascending: false });

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    if (statuses) {
      const statusArray = statuses.split(',').map((s) => s.trim());
      query = query.in('status', statusArray);
    }

    if (aggregate === 'revenue') {
      query = query.select('items, status');
      const { data, error } = await query;
      if (error) throw error;

      const totalRevenue = data
        .filter((order) => order.status === 'paid')
        .reduce((sum, order) => {
          if (!Array.isArray(order.items)) return sum;
          return sum + order.items.reduce((itemSum, item) => itemSum + (item.price || 0) * (item.quantity || 1), 0);
        }, 0);

      return res.json({ totalRevenue });
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    console.error('GET /api/admin/orders/history - Error:', error);
    res.status(500).json({ error: `Failed to fetch order history: ${error.message}` });
  }
});

// Analytics: Total Orders
app.get('/api/admin/analytics/total-orders', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = supabase.from('orders').select('id', { count: 'exact' }).eq('status', 'paid');

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
    let query = supabase.from('orders').select('items').eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const totalRevenue = data.reduce((sum, order) => {
      if (!Array.isArray(order.items)) return sum;
      return sum + order.items.reduce((itemSum, item) => itemSum + (item.price || 0) * (item.quantity || 1), 0);
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
    let query = supabase.from('orders').select('items').eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const itemQuantities = {};
    data.forEach((order) => {
      if (!Array.isArray(order.items)) return;
      order.items.forEach((item) => {
        const name = item.name || 'Unknown';
        const quantity = parseInt(item.quantity) || 1;
        itemQuantities[name] = (itemQuantities[name] || 0) + quantity;
      });
    });

    const mostSold = Object.entries(itemQuantities).reduce(
      (max, [name, totalSold]) => (totalSold > max.totalSold ? { name, totalSold } : max),
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
    let query = supabase.from('orders').select('created_at').eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const hourCounts = Array(24).fill(0);
    data.forEach((order) => {
      if (!order.created_at) return;
      const date = new Date(order.created_at);
      date.setHours(date.getHours() + 5); // Convert UTC to IST
      date.setMinutes(date.getMinutes() + 30);
      const hour = date.getHours();
      hourCounts[hour]++;
    });

    const peakHourIndex = hourCounts.reduce((maxIdx, count, idx, arr) => (count > arr[maxIdx] ? idx : maxIdx), 0);
    const peakHour = hourCounts[peakHourIndex] > 0 ? `${peakHourIndex}:00-${peakHourIndex + 1}:00` : 'N/A';

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
    let query = supabase.from('orders').select('items').eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (!data.length) return res.json({ aov: 0 });

    const totalRevenue = data.reduce((sum, order) => {
      if (!Array.isArray(order.items)) return sum;
      return sum + order.items.reduce((itemSum, item) => itemSum + (item.price || 0) * (item.quantity || 1), 0);
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
    let query = supabase.from('orders').select('items').eq('status', 'paid');

    if (startDate && endDate) {
      query = query.gte('created_at', startDate).lte('created_at', endDate);
    }

    const { data, error } = await query;
    if (error) throw error;

    const totalItemsSold = data.reduce((sum, order) => {
      if (!Array.isArray(order.items)) return sum;
      return sum + order.items.reduce((itemSum, item) => itemSum + (parseInt(item.quantity) || 1), 0);
    }, 0);

    res.json({ totalItemsSold: totalItemsSold || 0 });
  } catch (error) {
    console.error('GET /api/admin/analytics/total-items-sold - Error:', error);
    res.status(500).json({ error: `Failed to fetch total items sold: ${error.message}` });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});