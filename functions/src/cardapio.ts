import * as functions from "firebase-functions";
import * as admin from "firebase-admin";

import * as rp from "request-promise";
import * as cheerio from "cheerio";
import * as fs from "fs";

// @ts-ignore
import * as pdf_table_extractor from "pdf-table-extractor";

const tempFilePath = "/tmp/cardapio.pdf";

const options = {
  uri: "http://portais.univasf.edu.br/proae/restaurante-universitario/cardapio",
  timeout: 10000,
  transform: function (body: any) {
    return cheerio.load(body);
  }
};

const getCardapioUrl = ($: CheerioStatic) =>
  $("div:nth-child(1) > h3 > a")
    .first()
    .attr("href");

const parseCardapio = () =>
  new Promise((resolve) => {
    const success = (data: { pageTables: { tables: any; }[]; }) => {
      const { tables } = data.pageTables[0];
      const days = tables[0].splice(1);

      const result: any = {};
      const meals = [
        { type: "breakfast", itens: 5, startAt: 1 },
        { type: "lunch", itens: 9, startAt: 8 },
        { type: "dinner", itens: 9, startAt: 20 }
      ];

      days.forEach((day: string | number, daysIndex: number) => {
        result[day] = {};
        
        meals.forEach(meal => {
          const mealValues = [];
          for (let index = 0; index < meal.itens; index++) {
            mealValues.push({
              meal: tables[index + meal.startAt][0],
              description: tables[index + meal.startAt][daysIndex + 1]
            });
          }

          result[day][meal.type] = mealValues;
        });
      });

      resolve(result);
    };

    const error = (err: string) => {
      console.error("Error: " + err);
    };

    pdf_table_extractor(tempFilePath, success, error);
  });

const downloadFileAndExtractData = async (pdfUrl: string) =>
  new Promise(async resolve => {
    const file = fs.createWriteStream(tempFilePath);

    const extractData = async () => {
      const value = await parseCardapio();
      resolve(value);
    }

    await rp(pdfUrl).pipe(file).on("close", extractData);
  });

export const cardapioUpload = functions.https.onRequest(
  async (request, response) => {
    try {
      const document = await rp(options);
      const pdfUrl = getCardapioUrl(document);

      const data = await downloadFileAndExtractData(pdfUrl);

      // save to firestore
      const cardapioRef = await admin
        .firestore()
        .collection("cardapio")
        .doc("latest");

      await cardapioRef.set({ data });

      response.sendStatus(200);
    } catch (error) {
      console.log("error", error);
      response.sendStatus(500);
    }
  }
);
