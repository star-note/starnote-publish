import { getForm, publish } from './web';
import {
  getForm as electronForm,
} from './electron';
// import { taskLine } from './electron/utils';

// 各端所需的配置信息及发布方法
// 名字必须$publish_开头，后面必须与配置的key相同
// eslint-disable-next-line @typescript-eslint/naming-convention
export const $publish_github = {
  key: 'github',
  label: 'Github',
  logo: 'github', // 可直接访问的logo公网地址；或者内置图片config中、这里为key
  web: {
    getForm,
    publish,
  }, // web端发布的配置及方法
  electron: {
    getForm: electronForm,
    // publish: taskLine,
  }, // 桌面端发布的配置及方法
  server: {}, // 服务器端发布的配置及方法，对应node文件夹
  author: {
    name: 'ludejun',
    email: 'ludejun@live.cn',
    blog: '',
    userId: '0',
    avator: '',
  }, // 作者信息
};
