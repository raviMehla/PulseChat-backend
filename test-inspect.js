import mongoose from 'mongoose';

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/whatsapp_clone');
  console.log('Connected to MongoDB');
  const messages = await mongoose.connection.db.collection('messages').find({ chat: new mongoose.Types.ObjectId('6a1c647ea2ca974deb8fcbd6') }).sort({ createdAt: 1 }).toArray();
  console.log('Messages in chat:');
  console.log(JSON.stringify(messages, null, 2));
  
  await mongoose.disconnect();
}

run().catch(console.error);
