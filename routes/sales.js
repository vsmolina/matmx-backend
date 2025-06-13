const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'tmp/' });

const sales = require('../controllers/salesController');

const { authenticateUser } = require('../middleware/auth');

// ---------- QUOTES ----------

// List all quotes (filtered by role)
router.get('/quotes', authenticateUser, sales.getQuotes);

// Get a single quote with items
router.get('/quotes/:id', authenticateUser, sales.getQuoteById);

// Create a new quote
router.post('/quotes', authenticateUser, sales.createQuote);

// Update an existing quote
router.put('/quotes/:id', authenticateUser, sales.updateQuote);

// Convert a quote to an order
router.post('/quotes/:id/convert', authenticateUser, sales.convertQuoteToOrder);

// Send quote email
router.post('/quotes/:id/email', authenticateUser, sales.emailQuote);

// Upload a quote attachment
router.post('/quotes/:id/attachment', authenticateUser, upload.single('file'), sales.uploadQuoteAttachment);

// ---------- ORDERS ----------

// List all orders (filtered by role)
router.get('/orders', authenticateUser, sales.getOrders);

// Get a single order
router.get('/orders/:id', authenticateUser, sales.getOrderById);

// Update order status or shipping info
router.put('/orders/:id', authenticateUser, sales.updateOrder);

// Upload an order attachment
router.post('/orders/:id/attachment', authenticateUser, upload.single('file'), sales.uploadOrderAttachment);

module.exports = router;
