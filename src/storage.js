'use strict';

const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const config = require('./config');

/**
 * Build a BlobServiceClient using whichever credentials are configured.
 * Priority: connection string → account key → DefaultAzureCredential (Managed Identity / SP).
 */
function createBlobServiceClient() {
  if (config.connectionString) {
    return BlobServiceClient.fromConnectionString(config.connectionString);
  }

  if (!config.accountName) {
    throw new Error(
      'No Azure credentials found. Set AZURE_STORAGE_CONNECTION_STRING, ' +
        'or AZURE_STORAGE_ACCOUNT_NAME + AZURE_STORAGE_ACCOUNT_KEY, ' +
        'or AZURE_STORAGE_ACCOUNT_NAME with Managed Identity env vars.'
    );
  }

  if (config.accountKey) {
    const credential = new StorageSharedKeyCredential(config.accountName, config.accountKey);
    return new BlobServiceClient(
      `https://${config.accountName}.blob.core.windows.net`,
      credential
    );
  }

  // Fall back to DefaultAzureCredential (Managed Identity, Service Principal, Azure CLI, …)
  const credential = new DefaultAzureCredential();
  return new BlobServiceClient(
    `https://${config.accountName}.blob.core.windows.net`,
    credential
  );
}

/**
 * List all blobs in a container that were last modified after `since`.
 *
 * @param {BlobServiceClient} client
 * @param {string} containerName
 * @param {Date} since
 * @returns {AsyncIterable<import('@azure/storage-blob').BlobItem>}
 */
async function* listNewBlobs(client, containerName, since) {
  const container = client.getContainerClient(containerName);
  const options = config.blobPrefix ? { prefix: config.blobPrefix } : {};

  for await (const blob of container.listBlobsFlat(options)) {
    const lastModified = blob.properties.lastModified;
    if (lastModified && lastModified > since) {
      yield blob;
    }
  }
}

/**
 * Download a single blob to a writable stream.
 *
 * @param {BlobServiceClient} client
 * @param {string} containerName
 * @param {string} blobName
 * @param {import('fs').WriteStream} writeStream
 */
async function downloadBlob(client, containerName, blobName, writeStream) {
  const container = client.getContainerClient(containerName);
  const blobClient = container.getBlobClient(blobName);
  const response = await blobClient.download();

  await new Promise((resolve, reject) => {
    response.readableStreamBody.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
    response.readableStreamBody.on('error', reject);
  });
}

module.exports = { createBlobServiceClient, listNewBlobs, downloadBlob };
