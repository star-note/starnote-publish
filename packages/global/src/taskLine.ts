import { checkParams, getTimeStr, sleep } from './utils';
import { Task, TaskLine } from './types';
import { PuppeteerUtils } from './puppeteerUtils';

export const taskLine = async (
  props: TaskLine
) => {
  const {payload, getForm, getTasks, postProcess, key, page } = props;
  const { note } = payload;
  const tasks = getTasks(payload);
  const len = tasks.length;

  console.log(`---------任务线：${key}开始 ${getTimeStr()}---------`);
  checkParams(payload, getForm(note));
  postProcess(key, {
    time: new Date().getTime(),
    content: `参数校验成功，开始${key}发布任务`,
    process: 5,
  });
  for (let i = 0; i < len; i++) {
    const { fnName, params, info, msg, type, sub } = tasks[i] as Task;
    const process = parseInt((((i + 1) * 95) / len).toFixed(0)) + 5;
    try {
      console.log(`[${i + 1}] ${getTimeStr()} ${info}开始`);
      const utils = new PuppeteerUtils({ page });
      console.log(fnName, utils[fnName], params);
      const value = await utils[fnName](params);

      if (type === 'for' && sub.task.length > 0) {
        for (let i = 0; i < sub.count; i++) {
          for (let j = 0; j < sub.task.length; j++) {
            const { fnName: fn, params: p, msg: m, info: i } = sub.task[j];
            await utils[fn](p);
            if (m) {
              postProcess(key, {
                time: new Date().getTime(),
                content: `${i}完成`,
                ...m,
              });
            }
          }
        }
      } else if (type === 'if' && sub.task.length > 0) {
        if (value === sub.ifValue) {
          for (let j = 0; j < sub.task.length; j++) {
            const { fnName: fn, params: p, msg: m, info: i } = sub.task[j];
            await utils[fn](p);
            if (m) {
              postProcess(key, {
                time: new Date().getTime(),
                content: `${i}完成`,
                ...m,
              });
            }
          }
        }
      } else {
        console.log(`[${i + 1} / ${len}] ${getTimeStr()} ${info}完成`);
        if (msg) {
          postProcess(key, {
            time: new Date().getTime(),
            content: `${info}完成`,
            process,
            ...msg,
          });
        }
      }
    } catch (e) {
      console.log(e);
      if (msg) {
        postProcess(key, {
          time: new Date().getTime(),
          content: msg.fail || `${info}失败`,
          process,
          ...msg,
          status: 'fail',
        });
      } else {
        postProcess(key, {
          time: new Date().getTime(),
          content: `${info}失败`,
          status: 'fail',
          process,
        });
      }
      break;
    }
    await sleep();
  }
};
