// BasePage — shared actions every Page Object inherits.
class BasePage {
  constructor(page) {
    this.page = page;
  }

  async navigate(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async type(selector, text) {
    await this.page.fill(selector, text);
  }

  async click(selector) {
    await this.page.click(selector);
  }

  async getText(selector) {
    return this.page.textContent(selector);
  }

  async title() {
    return this.page.title();
  }

  async isVisible(selector) {
    return this.page.isVisible(selector);
  }
}

module.exports = BasePage;
