const express=require('express');
const mongoose=require('mongoose');
const cors=require('cors');
const dotenv=require('dotenv');
const connectDB = require('./src/config/db');


const CategoryRoutes = require('./src/routes/CategoryRoutes');
const app=express();

app.use(cors());
app.use(express.json());
dotenv.config();
connectDB();



app.use('/api',CategoryRoutes);


const PORT=process.env.PORT || 5000;
app.listen(PORT,()=>{
    console.log(" 🚀  Server started on port 5000");
})