const express = require('express');
const router = express.Router();

// Seller information routes
router.use('/sellers', require('./sellers'));
// Envanter güncellemesi batch endpoint (ülke seçimi + 20 sekme + shipping+seller)
router.use('/playwright', require('./playwright'));

module.exports = router;
