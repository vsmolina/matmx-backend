const express = require('express');
const router = express.Router();
const crm = require('../controllers/crmController');
const { authenticateUser, authorizeRoles } = require('../middleware/auth');

router.use(authenticateUser);

// --- Customer Management ---
router.get('/', crm.getCustomers);
router.post('/', crm.createCustomer);
router.get('/search', crm.searchCustomers);
router.put('/:id', crm.updateCustomer);
router.get('/customers/:id', crm.getCustomerById);
router.delete('/customers/:id', authorizeRoles('super_admin'), crm.deleteCustomer)

// --- Assignment ---
router.post('/:id/assign', authorizeRoles('super_admin'), crm.assignCustomer);
router.post('/:id/unassign', authorizeRoles('super_admin'), crm.unassignCustomer);

// --- Logs ---
// Admin-only system logs
router.get('/:id/logs', authorizeRoles('super_admin'), crm.getCRMLogs);

// Rep + admin visible interaction logs
router.get('/:id/interactions', crm.getCustomerInteractionLogs);
router.post('/:id/interactions', crm.addCustomerLog);

module.exports = router;