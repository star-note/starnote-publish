import { Page } from 'puppeteer';

export enum DomType {
  input = 'INPUT',
  select = 'SELECT',
  inputNumber = 'INPUTNUMBER',
  textarea = 'TEXTAREA',
  picker = 'IMAGEPICKER',
  checkbox = 'CHECKBOX',
  date = 'DATEPICKER',
}
export interface Config {
  dom: {
    type: DomType;
    defaultValue?: string | boolean | number | null; // 如是DATEPICKER类型，应是'YYYY-MM-DD'格式
    rule?: {
      pattern?: RegExp; // input的校验正则规则
      message?: string; // 错误显示信息
      size?: {
        height: CSSStyleDeclaration['height'];
        width: CSSStyleDeclaration['width'];
        maxBit?: number;
      }; // 给图片上传使用，限制长宽比和最大体积限制，maxBit单位MB（默认1M: 1）
      inputType?: string; // input的 type，如 password 等
    };
    placeholder?: string; // input的placeholder，checkbox的框后文案（默认为label），图片上传的框内文案（默认为上传图片）
    required?: boolean;
    options?: string[]; // Select下拉框选项，如没有，则用户自定义添加
  };
  name: string; // 每一个form.item的name，需要唯一
  label?: string; // 每一个form.item的label
  help?: {
    description: string;
    url?: string;
  }; // 填写的帮助说明或文档
}

export interface Message {
  time: number; // 时间戳
  process?: number;
  content: string;
  link?: string; // 文字、图片、卡片超链接
  type?: 'text' | 'url' | 'image' | 'card'; // message支持的类型，默认text
  status?: 'init' | 'pending' | 'fail' | 'publishing' | 'unsupported' | 'success'; // 默认为publishing
}

export interface Task {
  fnName: string;
  params?: any;
  info?: string;
  msg?: Partial<Message> & { fail?: string }; // 可用来自定义进度的 msg：process、content、状态等，默认就是使用info简单返回
  type?: 'for' | 'if'; // 本条任务的特殊 type，是有循环还是逻辑判断类型
  sub?: {
    count?: number; // for的sub执行次数，从 0 开始
    ifValue?: any; //  if的父任务 fnName 返回值进逻辑sub 的条件
    task: Task[]; // 子任务流水线，现只支持一层，不要再嵌套
  }; // 特殊任务的子分支
}

export interface TaskLine {
  page: Page;
  postProcess: (target: string, msg: Message) => void;
  payload: Record<string, any>;
  key: string;
  getForm: (note: any) => Config[];
  getTasks: ({ form: { username, password, repo, category, name }, note }: any) => Task[];
}
