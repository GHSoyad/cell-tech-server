import express, { NextFunction, Request, Response } from "express";
import { MongoClient, ObjectId } from "mongodb";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from 'bcrypt';
import moment from "moment";

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
    const productsCollection = database.collection('products');
    const salesCollection = database.collection('sales');


    // Updater
    // app.get('/updater', (req, res) => {
    //   res.send('Welcome to Updater!')
    //   const result = productsCollection.rename("products")
    //   res.status(201).send({success: true message: 'Updated successfully', content: result });
    // })

    // Auth
    app.post('/api/v1/auth/register', async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const userExists = await usersCollection.findOne(query);
      if (userExists) {
        res.status(409).send({ success: false, message: 'Already Registered with this Email!' })
        return;
      }

      const hashedPassword = await bcrypt.hash(user.password, Number(process.env.BCRYPT_SALT_ROUNDS));
      const result = await usersCollection.insertOne({
        ...user,
        password: hashedPassword,
        role: "user",
        status: true,
      });

      if (result.acknowledged) {
        const insertedUser = await usersCollection.findOne({ _id: result.insertedId });
        res.status(201).send({ success: true, message: 'Registered successfully', content: insertedUser });
      } else {
        res.status(409).send({ success: false, message: 'Failed to register user' });
      }
    });

    app.post('/api/v1/auth/login', async (req, res) => {
      const payload = req.body;
      const query = { email: payload.email };
      const user = await usersCollection.findOne(query);

      if (!user) {
        res.status(409).send({ success: false, message: 'User not found!' })
        return;
      }
      const isPasswordMatched = await bcrypt.compare(payload.password, user.password);
      if (!isPasswordMatched) {
        res.status(409).send({ success: false, message: 'Password is wrong!' })
        return;
      }

      const { _id, name, email, role } = user;
      const token = jwt.sign({ email }, process.env.JWT_SECRET as string, { expiresIn: process.env.JWT_ACCESS_EXPIRES_IN });
      const responseUser = { _id, name, email, role, token };

      res.status(200).send({ success: true, message: 'Logged in successfully', content: responseUser });
    })


    // Users
    app.get('/api/v1/users', verifyJWT, async (req: Request, res: Response) => {
      const query = {};
      const users = await usersCollection.find(query).toArray();
      res.status(200).send({ success: true, message: "Users Data Found!", content: users });
    })

    app.patch('/api/v1/user/:id', verifyJWT, async (req: Request, res: Response) => {
      const id = req.params.id;
      const user = req.body;

      try {
        const filter = { _id: new ObjectId(id) };
        const updateUser = {
          $set: {
            ...user
          }
        }
        const result = await usersCollection.updateOne(filter, updateUser);
        res.status(200).send({ success: true, message: "User Updated successfully!", content: result });
      }
      catch (error) {
        res.status(500).send({ success: false, message: 'Internal Server Error!' });
      }
    })


    // Products
    app.get('/api/v1/products', verifyJWT, async (req: Request, res: Response) => {
      const query = {};
      const products = await productsCollection.find(query).toArray();
      res.status(200).send({ success: true, message: "Data Found!", content: products });
    })

    app.post('/api/v1/product', verifyJWT, async (req: Request, res: Response) => {
      const product = req.body;
      try {
        const result = await productsCollection.insertOne({ ...product, sold: 0, status: true });
        res.status(201).send({ success: result.acknowledged, message: "Product Added successfully!", content: result });
      }
      catch (error) {
        if ((error as any).code === 11000) {
          res.status(409).send({ success: false, message: 'Product name already exists!' });
        } else {
          res.status(500).send({ success: false, message: 'Internal Server Error!' });
        }
      }
    })

    app.patch('/api/v1/product/:id', verifyJWT, async (req: Request, res: Response) => {
      const id = req.params.id;
      const product = req.body;

      try {
        const filter = { _id: new ObjectId(id) };
        const updateUser = {
          $set: {
            ...product
          }
        }
        const result = await productsCollection.updateOne(filter, updateUser);
        res.status(200).send({ success: true, message: "Product Updated successfully!", content: result });
      }
      catch (error) {
        if ((error as any).code === 11000) {
          res.status(409).send({ success: false, message: 'Product name already exists!' });
        } else {
          res.status(500).send({ success: false, message: 'Internal Server Error!' });
        }
      }
    })

    app.delete('/api/v1/product/:id', verifyJWT, async (req: Request, res: Response) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
      res.status(200).send({ success: true, message: 'Product Deleted successfully!', content: result });
    })

    app.delete('/api/v1/products', verifyJWT, async (req: Request, res: Response) => {
      const ids = req?.query?.ids;
      const mappedIds = (ids as string)?.split(",").map(id => new ObjectId(id));

      if (mappedIds.length < 1) {
        res.status(409).send({ message: 'Product not found!', success: false });
        return;
      }

      const query = { _id: { $in: mappedIds } };
      const result = await productsCollection.deleteMany(query);
      res.status(200).send({ success: true, message: 'Products Deleted successfully!', content: result });
    })


    // Sales
    app.get('/api/v1/sales', verifyJWT, async (req: Request, res: Response) => {
      let selectedDays = 1;
      const { currentYear, currentMonth, currentWeek, days, userId } = req.query;
      const matchStage: any = {};

      if (Number(days) > 0) {
        selectedDays = Number(days);
      }
      else if (Number(currentYear) > 0) {
        selectedDays = moment().dayOfYear();
      }
      else if (Number(currentMonth) > 0) {
        selectedDays = moment().date();
      }
      else if (Number(currentWeek) > 0) {
        selectedDays = moment().day();
      }
      if (userId) {
        matchStage.sellerId = new ObjectId(userId as string);
      }

      const daysAgo = moment().subtract(selectedDays, 'days').startOf('day');
      matchStage.dateSold = { $gte: daysAgo.toDate() }

      const sales = await salesCollection.aggregate([
        {
          $match: matchStage,
        },
        {
          $lookup: {
            from: "products",
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

      res.status(200).send({ success: true, message: "Data Found!", content: sales });
    })

    app.post('/api/v1/sale', verifyJWT, async (req: Request, res: Response) => {
      try {
        const { productId, quantitySold } = req.body;

        const product = await productsCollection.findOne({ _id: new ObjectId(productId) });

        if (!product) {
          return res.status(409).send({ success: false, message: "Product not found!" });
        }
        if (quantitySold > product.stock) {
          return res.status(409).send({ success: false, message: "Quantity sold is more than available stock!" });
        }

        const newStock = product.stock - quantitySold;

        const filter = { _id: new ObjectId(productId) };
        const updateProduct = {
          $set: {
            stock: newStock,
            sold: product.sold + quantitySold,
            status: newStock > 0
          }
        };
        await productsCollection.updateOne(filter, updateProduct);

        // Insert sale record into salesCollection
        const sale = {
          ...req.body,
          productId: new ObjectId(productId),
          dateSold: new Date(req.body.dateSold),
          sellerId: new ObjectId(req.body.sellerId),
        };
        const result = await salesCollection.insertOne(sale);

        res.status(201).send({ success: true, message: "Sale added successfully!", content: result });
      } catch (error) {
        res.status(500).send({ success: false, message: 'Internal Server Error!' });
      }
    })


    // Statistics
    app.get('/api/v1/statistics/sales', verifyJWT, async (req: Request, res: Response) => {
      let selectedDays = 1;

      const { currentYear, currentMonth, currentWeek, days, userId } = req.query;
      const matchStage: any = {};

      if (Number(days) > 0) {
        selectedDays = Number(days);
      }
      else if (Number(currentYear) > 0) {
        selectedDays = moment().dayOfYear();
      }
      else if (Number(currentMonth) > 0) {
        selectedDays = moment().date();
      }
      else if (Number(currentWeek) > 0) {
        selectedDays = moment().day();
      }
      if (userId) {
        matchStage.sellerId = new ObjectId(userId as string);
      }

      const daysAgo = moment().subtract(selectedDays, 'days').startOf('day');
      matchStage.dateSold = { $gte: daysAgo.toDate() }

      const result = await salesCollection.aggregate([
        {
          $match: matchStage,
        },
        {
          $group: {
            _id: { $dateToString: { format: "%d-%m-%Y", date: "$dateSold" } }, // Group by day
            totalAmountSold: { $sum: "$totalAmount" }
          }
        }
      ]).toArray();

      const latestDaysList = Array.from({ length: selectedDays }, (_, i) =>
        moment().subtract(i, 'days').format('DD-MM-YYYY')
      );

      const resultMap = new Map(result.map(item => [item?._id, item?.totalAmountSold]));

      const finalResult = latestDaysList.map(day => ({
        date: day,
        day: moment(day, "DD-MM-YYYY").format("dddd"),
        totalAmountSold: resultMap.get(day) || 0
      }));

      // Return the final result
      res.status(200).send({ success: true, message: "Data Found!", content: finalResult });
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