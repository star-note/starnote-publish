import { ElementHandle, Page } from 'puppeteer';
import { getTimeStr, isUrl, sleep } from './utils';

export class PuppeteerUtils {
  page: Page;
  constructor(props) {
    const { page } = props;
    this.page = page;
  }

  // 跳转页面，校验是否成功
  gotoUrl = async ({
    url,
    options = {},
    selector,
  }: {
    url: string;
    options?: Parameters<Page['goto']>[1];
    selector?: string;
  }) => {
    if (isUrl(url)) {
      let checked = true;
      await this.page.goto(url, {
        timeout: 60000,
        waitUntil: 'load',
        ...options,
      });
      this.page
        .on('load', () => console.log('跳转成功'))
        .on('error', (err) => {
          console.log('页面崩溃：', err);
          checked = false;
        });

      await sleep();
      if (selector) {
        checked = !(await this.queryDom({ selector }));
      }
      console.log(`完成页面${url}跳转，${selector || '无 '}校验结果为${checked}`);

      return checked;
    } else {
      throw new Error('URL无效，请检查!');
    }
  };

  // 检验页面某dom https://puppeteer.bootcss.com/api#pageselector
  queryDom = async ({ selector, getOne = true }: { selector: string; getOne?: boolean }) => {
    let dom: ElementHandle | ElementHandle[] | null;
    if (getOne) {
      dom = await this.page.$(selector);
      // 找不到就先等等
      if (!dom) {
        dom = await this.page.waitForSelector(selector); // 最多 30s 超时
      }
    } else {
      dom = await this.page.$$(selector);
    }

    return dom;
  };

  // dom点击
  clickDom = async ({
    selector,
    willNavigation = false,
    options,
  }: {
    selector: string;
    willNavigation?: boolean;
    options?: Parameters<Page['click']>[1];
  }) => {
    const op = {
      delay: 100,
      ...options,
    };
    const dom = await this.queryDom({ selector });
    this.page.hover(selector); // selector会滚动到中间
    if (dom) {
      if (willNavigation) {
        const [response] = await Promise.all([
          this.page.waitForNavigation(), // The promise resolves after navigation has finished
          this.page.click(selector, op), // 点击该链接将间接导致导航(跳转)
        ]);
      } else {
        console.log(selector, op);
        await this.page.click(selector);
      }
      await sleep();
      console.log(`完成点击${selector}`);
      return dom;
    } else {
      throw new Error(`点击元素不存在：${selector}`);
    }
  };

  // 输入内容
  inputContent = async ({ selector, content }: { selector: string; content: string }) => {
    if (content) {
      const input = await this.page.$(selector);
      // https://it.cha138.com/wen4/show-11542106.html
      await input.click({ clickCount: 3 });
      // await page.keyboard.press('Backspace');

      await sleep();
      await this.page.keyboard.type(content, { delay: 100 });
      console.log(`完成在${selector}中输入内容：${content}`);
    } else {
      throw new Error('输入内容为空，请检查！');
    }
  };

  // 获取内容
  getContent = async ({
    selector,
    type = 'innerText',
  }: {
    selector: string;
    type?: 'innerText' | 'value' | 'innerHTML';
  }) => {
    const result = await this.page.$eval(
      selector,
      (ele, type) => {
        return ele[type];
      },
      type,
    );
    console.log(`获取${selector}内容的${type}: `, result);
    return result;
  };

  // select options选择
  selectOption = async ({
    selector,
    optionSelector,
    type = 'click',
    clickOptions,
  }: {
    selector: string;
    optionSelector: string;
    type?: 'click' | 'hover';
    clickOptions?: {
      willNavigation?: boolean;
      options?: Parameters<Page['click']>[1];
    };
  }) => {
    if (type === 'click') {
      await this.clickDom({ selector, ...clickOptions });
    } else {
      this.page.hover(selector);
    }
    await this.clickDom({ selector: optionSelector, ...clickOptions });
  };

  // 下载文件
  download = async ({ selector }) => {
    const downloadBtn = await this.page.waitForSelector(selector);
    await downloadBtn.click();
  };

  // 屏幕截图或某个dom的截图，返回的是图片 buffer
  screenshot = async ({
    selector,
    clip,
    options,
  }: {
    selector?: string;
    clip?: Parameters<Page['screenshot']>[0]['clip'];
    options?: Parameters<Page['screenshot']>[0];
  }) => {
    let img;
    if (clip) {
      img = await this.page.screenshot({ ...options, clip });
    } else if (selector) {
      const dom = await this.page.$(selector);
      const boundingBox = await dom.boundingBox();
      img = await this.page.screenshot({
        ...options,
        clip: {
          x: boundingBox.x,
          y: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height,
        },
      });
    } else if (options) {
      img = await this.page.screenshot({ ...options });
    }
    return img;
  };

  // 监控页面中请求结果
  monitorResponse = ({ url, successTasks, failTasks }) => {
    return new Promise<void>((res, rej) => {
      this.page.on('response', async (response) => {
        try {
          if (response.url() === url) {
            if (response.ok()) {
              console.log(`${url}请求成功，开始执行 callback`);
              for (let i = 0; i < successTasks.length; i++) {
                const { fnName, params, info } = successTasks[i];
                console.log(`[${i + 1}] ${getTimeStr()} ${info}开始`);
                const utils = new PuppeteerUtils({ page: this.page });
                await utils[fnName](params);
              }
            } else {
              console.log(`${url}请求失败，开始执行 callback`);
              for (let i = 0; i < failTasks.length; i++) {
                const { fnName, params, info } = failTasks[i];
                console.log(`[${i + 1}] ${getTimeStr()} ${info}开始`);
                const utils = new PuppeteerUtils({ page: this.page });
                await utils[fnName](params);
              }
            }
          }
          res();
        } catch (e) {
          rej(e);
        }
      });
    });
  };

  // 请求接口
  request = (url, options) => {
    return fetch(url, options);
  };
}
