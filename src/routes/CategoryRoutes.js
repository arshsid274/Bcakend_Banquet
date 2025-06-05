const express = require('express');
const router = express.Router();
const {getAllCategory,createCategory} = require('../controllers/CategoryController');

// router.post('/create', createCustomer);
router.get('/getAllCategory',getAllCategory);

router.post('/create', createCategory);


module.exports = router;
