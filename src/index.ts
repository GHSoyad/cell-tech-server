import express, { NextFunction, Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from 'bcrypt';

const port = process.env.PORT || 5000;
const app = express();
app.use(cors());
app.use(express.json());
dotenv.config();
const client = new MongoClient(process.env.DB_URL || "");

const verifyJWT = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'Unauthorized User' })
  }

  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.JWT_SECRET as string, function (err, user) {
    if (err) {
      return res.status(403).send({ message: 'Forbidden Access' })
    }
    (req as any).user = user;
    next()
  })
}

async function run() {
  try {
    const database = client.db(process.env.DB_NAME);
    const usersCollection = database.collection('users');
    const phonesCollection = database.collection('phones');
    const salesCollection = database.collection('sales');


    // Auth
    app.post('/api/v1/auth/register', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const userExists = await usersCollection.findOne(query);
      if (userExists) {
        res.status(409).send({ message: 'Already Registered with this Email!', success: false })
        return;
      }

      const hashedPassword = await bcrypt.hash(user.password, Number(process.env.BCRYPT_SALT_ROUNDS));
      const result = await usersCollection.insertOne({ ...user, password: hashedPassword, role: "user" });

      if (result.acknowledged) {
        const insertedUser = await usersCollection.findOne({ _id: result.insertedId });
        res.status(201).send({ message: 'Registered successfully', content: insertedUser, success: true });
      } else {
        res.status(409).send({ message: 'Failed to register user', success: false });
      }
    });

    app.post('/api/v1/auth/login', async (req, res) => {
      const payload = req.body;
      const query = { email: payload.email };
      const user = await usersCollection.findOne(query);

      if (!user) {
        res.status(409).send({ message: 'User not found!', success: false })
        return;
      }
      const isPasswordMatched = await bcrypt.compare(payload.password, user.password);
      if (!isPasswordMatched) {
        res.status(409).send({ message: 'Password is wrong!', success: false })
        return;
      }

      const { _id, name, email, role } = user;
      const token = jwt.sign({ email }, process.env.JWT_SECRET as string, { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN });
      const responseUser = { userId: _id, name, email, role, token };

      res.status(200).send({ message: 'Logged in successfully', success: true, content: responseUser });
    })


    // Products
    app.get('/api/v1/phones', verifyJWT, async (req: Request, res: Response) => {
      const query = {};
      const phones = await phonesCollection.find(query).toArray();
      res.status(200).send({ success: true, content: phones, message: "Data Found!" });
    })

    app.post('/api/v1/phone', verifyJWT, async (req: Request, res: Response) => {
      const phone = req.body;
      try {
        const result = await phonesCollection.insertOne(phone);
        res.status(201).send({ success: result.acknowledged, content: result, message: "Product Added successfully!" });
      }
      catch (error) {
        if ((error as any).code === 11000) {
          res.status(409).send({ message: 'Product name already exists!', success: false });
        } else {
          res.status(500).send('Internal Server Error!');
        }
      }
    })

    app.patch('/api/v1/phone/:id', verifyJWT, async (req: Request, res: Response) => {
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
        if ((error as any).code === 11000) {
          res.status(409).send({ message: 'Product name already exists!', success: false });
        } else {
          res.status(500).send('Internal Server Error!');
        }
      }
    })

    app.delete('/api/v1/phone/:id', verifyJWT, async (req: Request, res: Response) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await phonesCollection.deleteOne(query);
      res.status(200).send({ message: 'Product Deleted successfully!', success: true, content: result });
    })


    // Sales
    app.get('/api/v1/sales', async (req: Request, res: Response) => {
      let query = {};

      if (req.query.days) {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - Number(req.query.days));
        daysAgo.setHours(0, 0, 0, 0);
        query = { dateSold: { $gte: daysAgo } }
      }

      const sales = await salesCollection.aggregate([
        {
          $match: query
        },
        {
          $lookup: {
            from: "phones",
            localField: "productId",
            foreignField: "_id",
            as: "product"
          }
        },
        {
          $lookup: {
            from: "users",
            localField: "sellerId",
            foreignField: "_id",
            as: "seller"
          }
        },
        {
          $unwind: { path: "$product", preserveNullAndEmptyArrays: true }
        },
        {
          $unwind: "$seller",
        },
        {
          $sort: { _id: -1 }
        },
        {
          $project: { seller: { password: 0 } }
        }
      ]).toArray();

      res.status(200).send({ success: true, content: sales, message: "Data Found!" });
    })

    app.post('/api/v1/sale', verifyJWT, async (req: Request, res: Response) => {
      try {
        const { productId, quantitySold } = req.body;

        const phone = await phonesCollection.findOne({ _id: new ObjectId(productId) });

        if (!phone) {
          return res.status(404).send({ success: false, message: "Phone not found!" });
        }
        if (quantitySold > phone.stock) {
          return res.status(400).send({ success: false, message: "Quantity sold is more than available stock!" });
        }

        const newStock = phone.stock - quantitySold;

        const filter = { _id: new ObjectId(productId) };
        const updatePhone = {
          $set: {
            stock: newStock,
            sold: phone.sold + quantitySold,
            status: newStock > 0
          }
        };
        await phonesCollection.updateOne(filter, updatePhone);

        // Insert sale record into salesCollection
        const sale = {
          ...req.body,
          productId: new ObjectId(productId),
          dateSold: new Date(req.body.dateSold),
          sellerId: new ObjectId(req.body.sellerId),
        };
        const result = await salesCollection.insertOne(sale);

        res.status(201).send({ success: true, content: result, message: "Sale added successfully!" });
      } catch (error) {
        console.error("Error processing sale:", error);
        res.status(500).send('Internal Server Error!');
      }
    })


    // Statistics
    app.get('/api/v1/statistics/sales', verifyJWT, async (req: Request, res: Response) => {
      let selectedDays = 1;

      if (Number(req?.query?.days)) {
        selectedDays = Number(req?.query?.days);
      }
      else if (req?.query?.currentMonth) {
        selectedDays = new Date().getDate();
      }
      else if (req.query.currentWeek) {
        selectedDays = new Date().getDay();
      }

      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - selectedDays);

      const result = await salesCollection.aggregate([
        {
          $match: {
            dateSold: { $gte: daysAgo } // Filter documents created in the last selected days
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$dateSold" } }, // Group by day
            totalAmountSold: { $sum: "$totalAmount" } // Compute sum of 'totalAmount' field for each day
          }
        }
      ]).toArray();

      // Create an array of last selected days
      const latestDaysList = [];
      const currentDate = new Date();
      for (let i = 0; i < selectedDays; i++) {
        const date = new Date(currentDate);
        date.setDate(currentDate.getDate() - i);
        latestDaysList.push(date.toISOString().slice(0, 10));
      }

      // Convert the result array to a Map for faster lookup
      const resultMap = new Map(result.map(item => [item._id, item.totalAmountSold]));

      // Left join the result with last 7 days array
      const finalResult = latestDaysList.map(day => ({
        date: day,
        totalAmountSold: resultMap.get(day) || 0, // Get totalAmount from resultMap, default to 0 if not found
      }));

      // Return the final result
      res.status(200).send({ success: true, content: finalResult, message: "Data Found!" });
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