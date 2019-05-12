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

const MealType = {
  BREAKFAST: 'breakfast',
  LUNCH: 'lunch',
  DINNER: 'dinner'
}

const MapTypeToLocations = {
  [MealType.BREAKFAST]: 'Café no CCA',
  [MealType.LUNCH]: 'Almoço em Juazeiro, Sede e CCA',
  [MealType.DINNER]: 'Jantar em Juazeiro, Sede e CCA',
}

const MapTypeToTime = {
  [MealType.BREAKFAST]: '7h às 08h30',
  [MealType.LUNCH]: '11h às 14h',
  [MealType.DINNER]: ' 17h30 às 20h (exceto no CCA)',
}

const MapBreakfastToImages: { [key: number]: string } = {
  0: 'drink_coffe',
  1: 'pao',
  2: 'frutas',
  3: 'cuscuz',
  4: 'ovos'
}

const MapLunchToImages: { [key: number]: string } = {
  0: 'salada_crua',
  1: 'vinagrete',
  2: 'salada_cozida',
  3: 'principal',
  4: 'frango',
  5: 'vegetariano',
  6: 'farofa',
  7: 'arroz',
  8: 'sucos',
  9: 'chocolate',
}

const MapDinnerToImages: { [key: number]: string } = {
  0: 'salada_crua',
  1: 'vinagrete',
  2: 'arroz',
  3: 'principal',
  4: 'vegetariano',
  5: 'cuscuz',
  6: 'pao',
  7: 'sopa',
  8: 'drink_coffe',
}

const mapImages = ({ type, index }: { type: string; index: number }) => {
  if (type === MealType.BREAKFAST) {
    return MapBreakfastToImages[index];
  }
  if (type === MealType.LUNCH) {
    return MapLunchToImages[index];
  }
  if (type === MealType.DINNER) {
    return MapDinnerToImages[index];
  }
  return null;
}

const tabDayLabel = (a: string) => a.substr(0, 3).concat('/', a.split('/')[0].substr(-2));

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
      const meals: Array<{ type: string; itens: number; startAt: number }> = [
        { type: MealType.BREAKFAST, itens: 5, startAt: 1 },
        { type: MealType.LUNCH, itens: 10, startAt: 8 },
        { type: MealType.DINNER, itens: 9, startAt: 20 }
      ];

      days.forEach((day: string, idx: number) => {
        const dayIndex = idx + 1
        result[dayIndex] = { day, tabDayLabel: tabDayLabel(day) };

        meals.forEach(meal => {
          const mealValues = [];

          for (let index = 0; index < meal.itens; index++) {
            const mealDescription = tables[index + meal.startAt][0];

            mealValues.push({
              meal: !!mealDescription ? mealDescription : 'Principal',
              description: tables[index + meal.startAt][dayIndex],
              image: mapImages({ type: meal.type, index }),
            });
          }

          result[dayIndex][meal.type] = {
            'data': mealValues,
            'location': MapTypeToLocations[meal.type],
            'time': MapTypeToTime[meal.type],
          }
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

      response.json({ data });
    } catch (error) {
      console.log("error", error);
      response.sendStatus(500);
    }
  }
);
