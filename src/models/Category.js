const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  CategoryName: {
    type: String,
    required: true,
    trim: true
  },
VegNonVeg: {
  type: String,
  trim: true,
  enum: ['Veg', 'Non-Veg'],
  default: ''
}
  // phone: {
  //   type: String,
  //   required: true,
  //   trim: true,
  //   match: [/^[6-9]\d{9}$/, 'Enter a valid 10-digit phone number']
  // },
  // email: {
  //   type: String,
  //   required: true,
  //   trim: true,
  //   lowercase: true,
  //   match: [/\S+@\S+\.\S+/, 'Enter a valid email']
  // },
  // address: {
  //   type: String,
  //   trim: true,
  //   default: ''
  // },
  // postalCode: {
  //   type: String,
  //   trim: true,
  //   match: [/^\d{6}$/, 'Enter a valid 6-digit postal code'],
  //   default: ''
  // }
}, {
  timestamps: true
});

module.exports = mongoose.model('FoodCategoryBanquet', CategorySchema);
