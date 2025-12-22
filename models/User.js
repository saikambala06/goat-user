const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ======================================================================
// DENORMALIZED SCHEMA STRUCTURE (Matches Client-side State Persistence)
// ======================================================================

// 1. Cart Item Schema (Denormalized - stores full item snapshot, not just ObjectId)
const cartItemSchema = new mongoose.Schema(
  {
    // The client uses _id from Livestock model to fetch images
    _id: { type: String, required: true }, 
    name: { type: String, required: true },
    price: { type: Number, required: true },
    breed: { type: String },
    type: { type: String }, 
    selected: { type: Boolean, default: true },
  },
  { _id: false } // Do not generate an ObjectId for the subdocument
);

// 2. Address Schema (Detailed and Denormalized)
const addressSchema = new mongoose.Schema(
  {
    label: { type: String, default: '' },
    name: { type: String, required: true },
    line1: { type: String, required: true }, // Using line1 to encompass both 'line' and 'line1' fields
    line2: { type: String, default: '' },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    phone: { type: String, required: true },
  },
  { _id: false }
);

// 3. User Main Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  
  // Storage for persistent user state:
  cart: [cartItemSchema], // Stores item snapshots
  wishlist: [
    {
      type: String, // Stores Livestock IDs as strings (matching client's persistence logic)
    },
  ],
  addresses: [addressSchema],
  
  createdAt: { type: Date, default: Date.now },
});

// ======================================================================
// BCRYPT HASHING LOGIC (From the first uploaded file)
// ======================================================================

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Compare password instance method
userSchema.methods.comparePassword = function (candidatePassword) {
  // Uses bcrypt.compare to check the candidate password against the stored hash
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
