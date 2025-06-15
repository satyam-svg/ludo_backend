const cors = require('cors');
const express = require('express');
const userRoutes = require('./routes/userRoutes');

const app = express();
app.use(cors()); // 👈 allows all origins
app.use(express.json());

app.use('/api/users', userRoutes);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
