import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path, { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import * as ExcelJS from 'exceljs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const dbClient = new DynamoDBClient({ region: 'us-east-2' });
const client = new SFNClient();

const BASE_URL = 'https://equitypro.com/';

// s3 bucket: scraper-file-uploads
const s3Client = new S3Client({}); // s3 client


// steps:
/*
  - hit api gateway endpoint
  - hit lambda, - check dynamodb to see if website is in our list
  - if in list call step function to determine which lambda to go continue processing 
*/

export const handler = async (event) => {
  event = JSON.parse(event);
  const { url } = event.body;

  // check database for url
  // const res = dbClient.


  // call step function for processing
  /*
  const input = {
    stateMachineArn: '', // TODO: fill this in
    input: `{"url": ${url}}`
  };
*/
  // const command = new StartExecutionCommand(input);
  // const response = await client.send(command);

  await grabHTML(url);
};

const listingInfo = {};


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

  /*
  // create folder for property
  try {
    // TODO: this needs to be turned into a "folder" in s3
    const propertyURL = new URL(`./${title}/`, import.meta.url);
    const propertyFolder = await mkdir(propertyURL);

  } catch (err) {
    console.error('error creating property folder ', err);
    throw new Error(`error creating property folder ${JSON.stringify(err)}`);
  }
  */

  /*
  // create images folder
  try {
    // TODO: this needs to be turned into a nested "folder" in s3
    const folder = new URL(`./${title}/images`, import.meta.url);
    const createFolder = await mkdir(folder);
  } catch (err) {
    console.error('error creating folder ', err);
    throw new Error(`error creating nested folder ${JSON.stringify(err)}`);
  }
  */

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
    // const config = { responseType: '' };
    const response = await axios.get(url, config);

    const joined = join(`${title}`, 'images', matched[0]);

    response.data
      .pipe(
        await s3Client.send(
          new PutObjectCommand({
             Bucket: 'scraper-file-uploads',
             Key: joined,
             Body: fs.createWriteStream(joined)
          })
        )
      )
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

  // const images = $(detailsContainer).find('img.media__image');
  const images = $(detailsContainer).find('img.media__element');
  $(images).each(async (i, elem) => {
    // const src = $(elem).attr('data-lazy');
    const src = $(elem).attr('data-src');
    const imgSrc = `${BASE_URL}${src}`;
    imagesArr.push(imgSrc);
    await downloadImages(imgSrc, data.title);
  });
  data['images'] = imagesArr;
};
