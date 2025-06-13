const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventoryController');
const { authenticateUser, authorizeRoles } = require('../middleware/auth');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

router.get('/', authenticateUser, inventoryController.getAllProducts);
router.post('/', authenticateUser, authorizeRoles('super_admin', 'inventory_manager'), inventoryController.createProduct);
router.put('/:id', authenticateUser, authorizeRoles('super_admin', 'inventory_manager'), inventoryController.updateProduct);
router.post('/:id/adjust', authenticateUser, authorizeRoles('super_admin', 'inventory_manager'), inventoryController.adjustInventory);
router.get('/:id/history', authenticateUser, authorizeRoles('super_admin'), inventoryController.getProductHistory);
router.get('/reorder-alerts', authenticateUser, authorizeRoles('super_admin', 'inventory_manager', 'accountant', 'sales_rep', 'CSR'), inventoryController.getReorderAlerts);
router.get('/export', authenticateUser, authorizeRoles('super_admin', 'inventory_manager', 'accountant'), inventoryController.exportInventory);
router.post('/import', authenticateUser, authorizeRoles('super_admin', 'inventory_manager'), upload.single('csv'), inventoryController.importInventory);
router.get('/imports', authenticateUser, authorizeRoles('super_admin'), inventoryController.getImportLogs);


module.exports = router;