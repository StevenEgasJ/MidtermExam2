const port = process.env.PORT || 4011;
const express = require('express');
const app = express();
const mongoose = require('mongoose');

const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://juhuh3001_db_user:Espe123@cluster0.olchaay.mongodb.net/test?retryWrites=true&w=majority&appName=Cluster0';
mongoose.connect(mongoUri);

const db = mongoose.connection;
db.on('error', (error) => console.error('Mongo connection error:', error));
db.once('open', () => console.log('System connected to MongoDb Database'));
app.use(express.json());

const microphoneRoutes = require('./routes/microphone');

app.use('/api/microphone', microphoneRoutes);

app.listen(port, '0.0.0.0', () => {
    console.log(`Microphone service is running on port ${port}`);
});

module.exports = app;



