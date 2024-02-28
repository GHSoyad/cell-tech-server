import { Request } from "express";
import moment from "moment";
import { ObjectId } from "mongodb";

export const statisticsMatcher = (req: Request) => {
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

  return [matchStage, selectedDays];
}