import { BrowserContext, chromium, ElementHandle } from "playwright";
import fs from "fs";

function camelize(str: string) {
  return str.replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, function (match, index) {
    if (+match === 0) return ""; // or if (/\s+/.test(match)) for white spaces
    return index === 0 ? match.toLowerCase() : match.toUpperCase();
  });
}

const replacer = (_: string, value: string | null) =>
  value === null ? "" : value; // specify how you want to handle null values here

function createCSV(items: Array<Data>) {
  if (items) {
    const firstItem = items[0];
    if (firstItem) {
      const header = [
        "number",
        "price",
        "rank",
        "background",
        "skin",
        "hair",
        "mouth",
        "eyes",
        "eyebrows",
        "clothes",
        "headAccessory",
        "faceAccessory",
        "glasses",
        "url",
      ];
      return [
        header.join(","), // header row first
        ...items.map((row) =>
          header
            .map((fieldName) => {
              if (row) {
                const item = row[fieldName as keyof typeof firstItem];
                return JSON.stringify(item, replacer);
              }
            })
            .join(",")
        ),
      ].join("\r\n");
    }
  }

  return "";
}

type Traits = {
  hair?: string;
  headAccessory?: string;
  faceAccessorry?: string;
  glasses?: string;
  clothes?: string;
  eyes?: string;
  eyebrows?: string;
  mouth?: string;
  skin?: string;
  background?: string;
};

type Data =
  | ({
      number: string;
      price: string;
      rank?: string;
      url: string;
    } & Traits)
  | undefined;

async function fetchGlooms(number: number = 10) {
  const regex = /#(\d+).*Club([0-9.]+)/g;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 926 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36",
  });
  const page = await context.newPage();
  console.log("Let's get those Glooms from the floor!");
  await page.goto("https://solanart.io/collections/gloompunk");
  await page.waitForSelector(".cardbouge-img img");

  // Scrolls page until we get enough glooms
  let content: ElementHandle<SVGElement | HTMLElement>[] = [];
  while (content.length < number) {
    content = await page.$$(".card-body");
    console.log(content.length);

    const random = Math.random();
    const divBy = random > 0.5 && random < 0.9 ? random : 0.75;
    await page.evaluate(
      `window.scrollTo({top: (document.body.scrollHeight * ${divBy}), behavior: "smooth"})`
    );
    await page.waitForTimeout(1000);
  }

  console.log(`Getting information from the cheapest ${content.length} Glooms`);

  // Extract an formats text from each card
  const gloomIds = await Promise.all(
    content.map(async (el) => await el.textContent())
  );

  let glooms: Array<Data> = gloomIds.map((gloomId) => {
    if (gloomId) {
      const match = regex.exec(gloomId);
      regex.test(gloomId);

      if (match) {
        const [_, number, price] = match;
        const url = `https://gloom-rarity-page.vercel.app/punk/${number}`;

        return { number, price, url };
      }
    }
  });

  // Fetches data from rarity tool for each gloom
  const queue: Array<{
    gloom: Data;
    context: BrowserContext;
    resolve: (value: Data | PromiseLike<Data>) => void;
    reject: (reason?: any) => void;
  }> = []; // keep track of additional jobs to send to server
  let inFlight = false;

  async function fetchRarity(
    gloom: Data,
    context: BrowserContext,
    resolve: (value: Data | PromiseLike<Data>) => void,
    reject: (reason?: any) => void
  ) {
    if (!inFlight) {
      inFlight = true;

      if (gloom) {
        const { number, price, url } = gloom;

        try {
          const newPage = await context.newPage();
          console.log(`Fetching #${number} - ${queue.length} remaining`);
          await newPage.goto(
            `https://gloom-rarity-page.vercel.app/punk/${number}`
          );
          await newPage.waitForSelector(".self-end");
          const rankInfo = await newPage.textContent(".self-end");
          const traitsInfo = await newPage.$$(".bg-gray-900 .text-lg");

          const traitsParsed = await Promise.all(
            traitsInfo.map(async (el) => {
              const span = await el.$("span");
              return span?.textContent();
            })
          );

          const traits: Traits = traitsParsed
            .filter(Boolean)
            .reduce((traits, trait) => {
              if (!trait) {
                return traits;
              }

              const [key, value] = trait.split(":");
              return {
                ...traits,
                [camelize(key)]: value.trim(),
              };
            }, {});

          const rank = rankInfo?.split("#")[1];
          await newPage.close();

          inFlight = false;
          if (queue.length) {
            const item = queue.shift();
            if (item) {
              fetchRarity(item.gloom, item.context, item.resolve, item.reject);
            }
          }

          resolve({ number, price, rank, url, ...traits });
        } catch (e) {
          reject(e);
        }
      }
    } else {
      queue.push({ gloom, context, resolve, reject });
    }
  }

  glooms = await Promise.all(
    glooms.map(
      (gloom) =>
        new Promise<Data>((resolve, reject) =>
          fetchRarity(gloom, context, resolve, reject)
        )
    )
  );

  console.log("Finished... happy shopping!");
  await browser.close();

  const csvContent = createCSV(glooms);
  try {
    fs.writeFileSync("./data/glooms.csv", csvContent);
  } catch (err) {
    console.error(err);
  }

  process.exit(1);
}

fetchGlooms(100);
