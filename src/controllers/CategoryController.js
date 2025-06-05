// controllers/userController.js
const FoodCategoryBanquet = require('../models/Category');

exports.getAllCategory = async (req, res) => {
  const FoodCategoryBanquets = await FoodCategoryBanquet.find();
  res.json(FoodCategoryBanquets);
};


exports.createCategory = async (req, res) => {
  try{
const newCategory = new FoodCategoryBanquet(req.body);
     await newCategory.save();
     res.status(201).json(newCategory);
  }
  catch (error) {
    console.error('Error creating category:', error.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
     

}