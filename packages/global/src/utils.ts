import { Config } from "./types";

// 根据Confis检查参数
export const checkParams = (params: Record<string, unknown>, configs: Config[]) => {
  let matched = true;
  const isInclude = (arr1: string[], arr2: string[]) => arr2.every((val) => arr1.includes(val));
  if (
    !isInclude(
      configs.map((config) => config.name),
      Object.keys(params),
    )
  ) {
    matched = false;
  } else {
    configs.forEach((config) => {
      const value = params[config.name as keyof typeof params];
      if (config.dom.required && !value) {
        matched = false;
      }
      // 当检测项包涵正则rules
      if (config.dom.rule) {
        if (
          !config.dom.rule.pattern?.test(String(value)) ||
          value === undefined ||
          value === null
        ) {
          matched = false;
        }
      }
    });
  }

  return matched;
};

// 生成当前时间字符串
export const getTimeStr = () => {
  const time = new Date();
  const addLen = (num: number) => `0${num}`.slice(-2);
  return `${time.getFullYear()}-${addLen(time.getMonth() + 1)}-${addLen(
    time.getDate(),
  )} ${addLen(time.getHours())}:${addLen(time.getMinutes())}:${addLen(time.getSeconds())}`;
};

// 让程序 sleep 一段时间（ms）
export const sleep = (time = 1000) => {
  // eslint-disable-next-line compat/compat
  return new Promise((resolve) => setTimeout(resolve, time));
};

// 匹配URL地址，含协议
export function isUrl(url: string) {
  return /(?:(https?):\/\/)[\w\-]+(\.[\w\-]+)+([\w\-.,@?^=%&:\/~+#]*[\w\-@?^=%&\/~+#])?$/.test(url);
}
