const {
  inAppPurchase, BrowserWindow, app,
} = require('electron');
const i18n = require('i18next');
const { WizInternalError } = require('../../share/error');
const request = require('../common/request');
const users = require('../user/users');

let currentUserGuid;

function getCurrentUserGuid() {
  if (currentUserGuid) {
    return currentUserGuid;
  }
  //
  return users.getUsers()[0].userGuid;
}

async function verifyPurchase(transaction, receiptURL) {
  //
  let receiptData = null;
  try {
    receiptData = await request.downloadToData({
      url: receiptURL,
      method: 'GET',
    });
  } catch (err) {
    throw new WizInternalError(i18n.t('errorDownloadReceipt', {
      message: err.message,
    }));
  }

  const userData = users.getUserData(getCurrentUserGuid());
  const user = userData.user;
  //
  const data = {
    receipt: receiptData.toString('base64'),
    userGuid: user.userGuid,
    userId: user.userId,
    clientType: 'lite',
    apiVersion: app.getVersion(),
    transactionId: transaction.transactionIdentifier,
  };
  //
  try {
    await request.standardRequest({
      url: `https://as.wiz.cn/as/a/pay2/ios`,
      data,
      method: 'POST',
    });
    //
    return true;
  } catch (err) {
    throw new WizInternalError(i18n.t('errorVerifyPurchase', {
      message: err.message,
    }));
  }
}

async function sendTransactionsEvents(state, productIdentifier, userGuid, message) {
  const mainWindow = BrowserWindow.getAllWindows().find((win) => win.isMainWindow);
  if (!mainWindow) {
    return;
  }
  //
  const params = {
    state,
    productIdentifier,
    userGuid,
    message,
  };
  const paramsData = JSON.stringify(params);
  const script = `window.onTransactionsUpdated(${paramsData})`;
  await mainWindow.webContents.executeJavaScript(script);
}

// 尽早监听transactions事件.
inAppPurchase.on('transactions-updated', async (event, transactions) => {
  if (!Array.isArray(transactions)) {
    return;
  }

  // 检查每一笔交易.
  for (const transaction of transactions) {
    const payment = transaction.payment;

    switch (transaction.transactionState) {
      case 'purchasing':
        console.log(`Purchasing ${payment.productIdentifier}...`);
        await sendTransactionsEvents('purchasing', payment.productIdentifier);
        break;

      case 'purchased': {
        console.log(`${payment.productIdentifier} purchased.`);
        const receiptURL = inAppPurchase.getReceiptURL();
        const userGuid = await verifyPurchase(transaction, receiptURL);
        await sendTransactionsEvents('purchased', payment.productIdentifier, userGuid);
        inAppPurchase.finishTransactionByDate(transaction.transactionDate);
        break;
      }

      case 'failed':
        console.log(`Failed to purchase ${payment.productIdentifier}.`);
        await sendTransactionsEvents('failed', payment.productIdentifier, null, transaction.errorMessage);
        inAppPurchase.finishTransactionByDate(transaction.transactionDate);
        break;

      case 'restored': {
        console.log(`The purchase of ${payment.productIdentifier} has been restored.`);
        const receiptURL = inAppPurchase.getReceiptURL();
        const userGuid = await verifyPurchase(transaction, receiptURL);
        await sendTransactionsEvents('restored', payment.productIdentifier, userGuid);
        break;
      }

      case 'deferred':
        console.log(`The purchase of ${payment.productIdentifier} has been deferred.`);
        await sendTransactionsEvents('deferred', payment.productIdentifier);
        break;

      default:
        break;
    }
  }
});

async function queryProducts() {
  if (!inAppPurchase.canMakePayments()) {
    throw WizInternalError(i18n.t('errorNotAllowMakeInAppPurchase'));
  }
  //
  // 检索并显示产品描述.
  const PRODUCT_IDS = ['cn.wiz.note.lite.year'];
  const products = await inAppPurchase.getProducts(PRODUCT_IDS);
  // 检查参数.
  if (!Array.isArray(products) || products.length <= 0) {
    throw WizInternalError(i18n.t('errorReceiveProductionInfo'));
  }

  // 显示每个产品的名称和价格.
  products.forEach((product) => {
    console.log(`The price of ${product.localizedTitle} is ${product.formattedPrice}.`);
  });
  //
  return products;
}

async function purchaseProduct(event, userGuid, selectedProduct) {
  currentUserGuid = userGuid;
  if (!inAppPurchase.canMakePayments()) {
    throw WizInternalError(i18n.t('errorNotAllowMakeInAppPurchase'));
  }
  const selectedQuantity = 1;
  const productIdentifier = selectedProduct.productIdentifier;
  const isProductValid = await inAppPurchase.purchaseProduct(productIdentifier, selectedQuantity);
  if (!isProductValid) {
    throw WizInternalError(i18n.t('errorProductInNotValid'));
  }
  console.log('The payment has been added to the payment queue.');
  return true;
}

module.exports = {
  queryProducts,
  purchaseProduct,
};