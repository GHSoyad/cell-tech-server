import express, { Request, Response } from "express";
import { MongoClient } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";

const port = process.env.PORT || 5000;
const app = express();
app.use(cors());
app.use(express.json());
dotenv.config();
const client = new MongoClient(process.env.DB_URL || "");


async function run() {
  try {
    const database = client.db(process.env.DB_NAME);
    const phonesCollection = database.collection('phones');


    app.get('/api/v1/phones', async (req: Request, res: Response) => {
      const query = {};
      const phones = await phonesCollection.find(query).toArray();
      res.send(phones);
    })

  }
  finally { }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Welcome to Cell Tech!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})