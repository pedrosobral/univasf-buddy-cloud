import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
admin.initializeApp(functions.config().firebase);

import * as rp from "request-promise";
import * as cheerio from "cheerio";

function parse($: CheerioStatic) {
  const result: Array<{ title: string; url: string; datetime: Date }> = [];

  $("#content-core")
    .find(".tileItem")
    .each((_, element) => {
      const headline = $(element)
        .find(".tileHeadline a")
        .first();

      const title = $(headline).text();
      const url = $(headline).attr("href");

      const summary = $(element).find(".documentByLine span");

      const [day, month, year] = $(summary[1])
        .text()
        .split("/");

      const [hours, minutes] = $(summary[2])
        .text()
        .split("h");

      const datetime = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hours),
        parseInt(minutes)
      );

      result.push({
        title,
        url,
        datetime
      });
    });

  return result;
}

const options = {
  uri: "http://portais.univasf.edu.br/univasf/noticias/ultimas-noticias",
  timeout: 10000,
  transform: function(body: any) {
    return cheerio.load(body);
  }
};

interface News {
  title: string;
  datetime: Date;
  url: string;
}

interface Latest {
  data: News[];
}

export const getLatestNews = functions.https.onRequest(
  async (request, response) => {
    try {
      const document = await rp(options);

      const freshNews = parse(document);

      const newsRef = await admin
        .firestore()
        .collection("news")
        .doc("latest");

      const newsData = await newsRef.get();

      const firstNews = (newsData.data() as Latest).data[0];

      const lastNewsIndex = freshNews.findIndex(
        item => item.url === firstNews.url
      );

      console.log("lastNewsIndex ", lastNewsIndex);

      for (let index = 0; index < lastNewsIndex; index++) {
        const message = freshNews[index];
        await admin.messaging().sendToTopic('latest_news', {
          notification: {
            title: "Uma nova notícia",
            body: message.title
          }
        });
      }

      if (lastNewsIndex > 0) {
        await newsRef.set({ data: freshNews }, { merge: true });
      }

      response.sendStatus(200);
    } catch (error) {
      response.sendStatus(500);
    }
  }
);
