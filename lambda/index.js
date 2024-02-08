import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import * as ExcelJS from 'exceljs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const client = new DynamoDBClient({ region: 'us-east-2' });

const BASE_URL = 'https://equitypro.com/';

// s3 bucket: scraper-file-uploads

export const handler = async (event) => {
  console.log({ event });
};

const listingInfo = {};

// const { url } = req.body;
// console.log({ url });

// TODO: grab website HTML
// TODO: await grabHTML(website);

// TODO: need to upload details to s3
// TODO: zip the files and download them

const grabHTML = async (website) => {
  const workbook = new ExcelJS.default.Workbook();
  workbook.title = 'Property Details';

  // visit the property page
  const propertyHTML = (await axios.get(website)).data;
  const $ = cheerio.load(propertyHTML);

  // grab property title
  const title = $('div.property-details.view-display-id-title_property_details')
    .find('h1.no-margin')
    .text();

  if (!title) {
    console.error('no property found!');
    throw new Error('no property found!');
  }

  listingInfo[title] = {};
  listingInfo[title].title = title;

  // create worksheet
  const sheet = workbook.addWorksheet(`${title}`);

  // create folder for property
  try {
    // TODO: this needs to be turned into a "folder" in s3
    const propertyURL = new URL(`./${title}/`, import.meta.url);
    const propertyFolder = await mkdir(propertyURL);
  } catch (err) {
    console.error('error creating property folder ', err);
    throw new Error(`error creating property folder ${JSON.stringify(err)}`);
  }

  // create images folder
  try {
    // TODO: this needs to be turned into a nested "folder" in s3
    const folder = new URL(`./${title}/images`, import.meta.url);
    const createFolder = await mkdir(folder);
  } catch (err) {
    console.error('error creating folder ', err);
    throw new Error(`error creating nested folder ${JSON.stringify(err)}`);
  }

  // grab the property images
  await grabImageUrls(propertyHTML, listingInfo[title]);

  // grab the property details
  await grabPropertiesDetails(
    propertyHTML,
    listingInfo[title],
    sheet,
    workbook,
  );
};

const grabPropertiesDetails = (html, data, worksheet, workbook) => {
  const $ = cheerio.load(html);
  const cellColumns = [];
  const cols = [];

  // grab interior rehab details
  const interior = $('div.property-details.view-display-id-interior').find(
    'div.view-content div.views-row',
  );

  $(interior).each((i, elem) => {
    let fieldProperty = $(elem).find('div.field-type').text();
    fieldProperty = fieldProperty.replace(/\n\s{1,}/g, '');
    const fieldValue = $(elem).find('div.field-cost').text();
    cellColumns.push({
      header: fieldProperty.trim(),
      value: fieldValue.trim(),
    });
  });

  // grab exterior rehab details
  const exterior = $('div.property-details.view-display-id-exterior').find(
    'div.view-content div.views-row',
  );
  $(exterior).each((i, elem) => {
    let fieldProperty = $(elem).find('div.field-type').text();
    fieldProperty = fieldProperty.replace(/\n\s{1,}/g, '');
    const fieldValue = $(elem).find('div.field-cost').text();
    cellColumns.push({
      header: fieldProperty.trim(),
      value: fieldValue.trim(),
    });
  });

  // create worksheet columns
  for (const column of cellColumns) {
    cols.push({
      header: column.header,
      key: column.header.toLowerCase(),
    });
  }
  worksheet.columns = cols;

  const obj = {};
  // add data to cells
  for (const row of cellColumns) {
    obj[row.header.toLowerCase()] = row.value;
  }
  worksheet.addRow({ ...obj });
  workbook.xlsx.writeFile(`./${data.title}/propertyDetails.xlsx`);
};

const downloadImages = async (url, title) => {
  const imgRegex = /(?<=public\/)[\w-_.]+\.\w+/g;

  const decoded = decodeURI(url).replace(/ /g, '_');
  const matched = decoded.match(imgRegex);

  if (!matched) {
    return;
  }

  try {
    // grab the image stream
    const config = { responseType: 'stream' };
    const response = await axios.get(url, config);

    const joined = join(`${title}`, 'images', matched[0]);

    response.data
      .pipe(fs.createWriteStream(joined))
      .on('error', (err) => console.error('An error occurred ', err))
      .once('close', () => console.log('closing...'));
  } catch (err) {
    console.error(`There was an error downloading this ${url} image `, err);
  }
};

const grabImageUrls = async (html, data) => {
  const imagesArr = [];
  const $ = cheerio.load(html);
  const detailsContainer = $('div.main-wrapper div.container');

  const images = $(detailsContainer).find('img.media__image');
  $(images).each(async (i, elem) => {
    const src = $(elem).attr('data-lazy');
    const imgSrc = `${BASE_URL}${src}`;
    imagesArr.push(imgSrc);
    await downloadImages(imgSrc, data.title);
  });
  data['images'] = imagesArr;
};
