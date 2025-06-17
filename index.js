require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const port = process.env.PORT || 3001;

// CORS configuration
app.use(cors({
  origin: ['https://frontend-valtri.vercel.app', 'http://localhost:3000'],
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware
app.use(express.json());

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url} - Body:`, req.body, 'Query:', req.query);
  next();
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
  const { table_id, items, notes } = req.body;
  if (!table_id || !items || !Array.isArray(items)) {
    console.log('POST /api/orders - Invalid input');
    return res.status(400).json({ error: 'Table ID and non-empty items array are required' });
  }

  try {
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
// app.get('/api/admin/orders/history', async (req, res) => {
//   const { startDate, endDate, statuses, search, aggregate } = req.query;
//   try {
//     let query = supabase
//       .from('orders')
//       .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
//       .order('created_at', { ascending: false });

//     // Date range filter
//     if (startDate && endDate) {
//       query = query.gte('created_at', startDate).lte('created_at', endDate);
//     }

//     // Status filter
//     if (statuses) {
//       const statusArray = statuses.split(',').map(s => s.trim());
//       query = query.in('status', statusArray);
//     }

//     // Search by order_number or table number
//     if (search) {
//       const sanitizedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
//       query = query.or(`order_number.ilike.%${sanitizedSearch}%,tables.number.ilike.%${sanitizedSearch}%`);
//     }

//     // Handle aggregations
//     if (aggregate) {
//       const { data, error } = await query;
//       if (error) throw error;

//       if (aggregate === 'revenue') {
//         const totalRevenue = data.reduce((sum, order) => {
//           if (!Array.isArray(order.items)) {
//             console.warn(`Order ${order.id} has invalid items: ${order.items}`);
//             return sum;
//           }
//           return sum + order.items.reduce((s, item) => s + (item.price || 0) * (item.quantity || 1), 0);
//         }, 0);
//         return res.json({ totalRevenue });
//       }
//       if (aggregate === 'items_sold') {
//         const totalItemsSold = data.reduce((sum, order) => {
//           if (!Array.isArray(order.items)) {
//             console.warn(`Order ${order.id} has invalid items: ${order.items}`);
//             return sum;
//           }
//           return sum + order.items.reduce((s, item) => s + (item.quantity || 1), 0);
//         }, 0);
//         return res.json({ totalItemsSold });
//       }
//     }

//     const { data, error } = await query;
//     if (error) throw error;

//     res.json(data || []);
//   } catch (error) {
//     console.error('GET /api/admin/orders/history - Error:', error);
//     res.status(500).json({ error: `Failed to fetch order history: ${error.message}` });
//   }
// });

// Get order history (admin)
app.get('/api/admin/orders/history', async (req, res) => {
  const { startDate, endDate, statuses, search, aggregate } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select('id, order_number, created_at, table_id, items, status, notes, payment_type, tables(number)')
      .order('created_at', { ascending: false });

    // Date range filter (convert IST to UTC)
    if (startDate && endDate) {
      // Assume startDate and endDate are in IST (e.g., 2025-06-17T00:00:00+05:30)
      const startDateIST = new Date(startDate);
      const endDateIST = new Date(endDate);

      // Convert to UTC by subtracting 5 hours 30 minutes
      const startDateUTC = new Date(startDateIST.getTime() - (5.5 * 60 * 60 * 1000));
      const endDateUTC = new Date(endDateIST.getTime() - (5.5 * 60 * 60 * 1000));

      query = query
        .gte('created_at', startDateUTC.toISOString())
        .lte('created_at', endDateUTC.toISOString());
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

    // Convert created_at to IST for frontend display
    const dataWithIST = data.map(order => ({
      ...order,
      created_at: new Date(new Date(order.created_at).getTime() + (5.5 * 60 * 60 * 1000)).toISOString()
    }));

    res.json(dataWithIST || []);
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
      const istDate = new Date(order.created_at);
      istDate.setHours(istDate.getHours() + 5);
      istDate.setMinutes(istDate.getMinutes() + 30);
      const hour = istDate.getHours();
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