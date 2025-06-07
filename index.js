const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: ['https://frontend-kappa-blush-17.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Get pending orders
app.get('/api/orders', async (req, res) => {
  const { status } = req.query;
  console.log('GET /api/orders - Query:', { status });

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(number)')
      .eq('status', status || 'pending');

    if (error) throw error;
    console.log('GET /api/orders - Pending orders fetched:', data);
    res.json(data || []);
  } catch (error) {
    console.error('GET /api/orders - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get order by ID
app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(number)')
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('GET /api/orders/:id - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update order (e.g., edit items)
app.patch('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  const { items } = req.body;

  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ items })
      .eq('id', id)
      .select('*, tables(number)')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('PATCH /api/orders/:id - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Mark order as paid
app.patch('/api/orders/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { payment_type } = req.body;

  try {
    const { data, error } = await supabase
      .from('orders')
      .update({ status: 'paid', payment_type })
      .eq('id', id)
      .select('*, tables(number)')
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('PATCH /api/orders/:id/pay - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get order history
app.get('/api/admin/orders/history', async (req, res) => {
  const { startDate, endDate, statuses, aggregate } = req.query;
  console.log('GET /api/admin/orders/history - Query:', { startDate, endDate, statuses, aggregate });

  try {
    let query = supabase
      .from('orders')
      .select('*, tables(number)');

    if (startDate && endDate) {
      query = query
        .gte('created_at', startDate)
        .lte('created_at', endDate);
    }

    if (statuses) {
      const statusArray = statuses.split(',');
      query = query.in('status', statusArray);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (aggregate === 'revenue') {
      const totalRevenue = data.reduce((sum, order) => {
        if (!order.items || !Array.isArray(order.items)) return sum;
        return sum + order.items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
      }, 0);
      return res.json({ totalRevenue });
    }

    res.json(data || []);
  } catch (error) {
    console.error('GET /api/admin/orders/history - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Analytics: Total Orders
app.get('/api/admin/analytics/total-orders', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/total-orders - Query:', { startDate, endDate });

  try {
    let query = supabase
      .from('orders')
      .select('id')
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
    if (error) throw error;

    const totalOrders = data.length;
    res.json({ totalOrders });
  } catch (error) {
    console.error('GET /api/admin/analytics/total-orders - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Analytics: Total Revenue
app.get('/api/admin/analytics/total-revenue', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/total-revenue - Query:', { startDate, endDate });

  try {
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
    if (error) throw error;

    const totalRevenue = data.reduce((sum, order) => {
      if (!order.items || !Array.isArray(order.items)) return sum;
      return sum + order.items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
    }, 0);
    res.json({ totalRevenue });
  } catch (error) {
    console.error('GET /api/admin/analytics/total-revenue - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Analytics: Average Order Value
app.get('/api/admin/analytics/average-order-value', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/average-order-value - Query:', { startDate, endDate });

  try {
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
    if (error) throw error;

    const totalRevenue = data.reduce((sum, order) => {
      if (!order.items || !Array.isArray(order.items)) return sum;
      return sum + order.items.reduce((s, item) => s + (item.price * (item.quantity || 1)), 0);
    }, 0);
    const totalOrders = data.filter(order => order.items && Array.isArray(order.items)).length;
    const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    res.json({ aov });
  } catch (error) {
    console.error('GET /api/admin/analytics/average-order-value - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Analytics: Most Sold Item
app.get('/api/admin/analytics/most-sold-item', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/most-sold-item - Query:', { startDate, endDate });

  try {
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
    if (error) throw error;

    const itemCounts = {};
    data.forEach(order => {
      if (!order.items || !Array.isArray(order.items)) return;
      order.items.forEach(item => {
        const itemName = item.name || 'Unknown';
        const quantity = item.quantity || 1;
        itemCounts[itemName] = (itemCounts[itemName] || 0) + quantity;
      });
    });

    let mostSoldItem = { name: 'N/A', totalSold: 0 };
    for (const [name, totalSold] of Object.entries(itemCounts)) {
      if (totalSold > mostSoldItem.totalSold) {
        mostSoldItem = { name, totalSold };
      }
    }

    res.json(mostSoldItem);
  } catch (error) {
    console.error('GET /api/admin/analytics/most-sold-item - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Analytics: Peak Hours
app.get('/api/admin/analytics/peak-hours', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/peak-hours - Query:', { startDate, endDate });

  try {
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
    if (error) throw error;

    const hourCounts = {};
    data.forEach(order => {
      const hour = new Date(order.created_at).getUTCHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    });

    let peakHour = 'N/A';
    let maxOrders = 0;
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > maxOrders) {
        maxOrders = count;
        peakHour = `${hour}:00`;
      }
    }

    res.json({ peakHour });
  } catch (error) {
    console.error('GET /api/admin/analytics/peak-hours - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Analytics: Total Items Sold
app.get('/api/admin/analytics/total-items-sold', async (req, res) => {
  const { startDate, endDate } = req.query;
  console.log('GET /api/admin/analytics/total-items-sold - Query:', { startDate, endDate });

  try {
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
    if (error) throw error;

    const totalItemsSold = data.reduce((sum, order) => {
      if (!order.items || !Array.isArray(order.items)) return sum;
      return sum + order.items.reduce((s, item) => s + (item.quantity || 1), 0);
    }, 0);

    res.json({ totalItemsSold });
  } catch (error) {
    console.error('GET /api/admin/analytics/total-items-sold - Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});