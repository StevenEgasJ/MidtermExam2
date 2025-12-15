const port = process.env.PORT || 4011;
const express = require('express');
const app = express();
const mongoose = require('mongoose');

// Prefer environment variable; fall back to local 'microphone' database
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/microphone';
mongoose.connect(mongoUri, { useNewUrlParser: true, useUnifiedTopology: true });

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



