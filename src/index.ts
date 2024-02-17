import express, { Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
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

    app.post('/api/v1/phone', async (req: Request, res: Response) => {
      const phone = req.body;
      const result = await phonesCollection.insertOne(phone);
      res.status(201).send({ success: result.acknowledged, content: result, message: "Product Added successfully!" });
    })

    app.patch('/api/v1/phone/:id', async (req: Request, res: Response) => {
      const id = req.params.id;
      const phone = req.body;

      try {
        const filter = { _id: new ObjectId(id) };
        const updateUser = {
          $set: {
            ...phone
          }
        }
        const result = await phonesCollection.updateOne(filter, updateUser);
        res.status(200).send({ success: true, content: result, message: "Product Updated successfully!" });
      }
      catch (error) {
        res.status(500).send('Internal Server Error!');
      }
    })

    app.delete('/api/v1/phone/:id', async (req: Request, res: Response) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await phonesCollection.deleteOne(query);
      res.status(200).send({ message: 'Product Deleted successfully!', success: true, content: result });
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