const { Given, Then } = require('../fixtures/bdd');
Given('the video smoke page is open', async function () {
  await this.page.setContent('<h1 style="font:48px sans-serif">video smoke</h1>');
  await this.page.waitForTimeout(800);
});
Then('the video smoke assertion fails', async function () {
  throw new Error('intentional failure');
});
