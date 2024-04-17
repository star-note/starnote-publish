import { Config, DomType, Task, TaskLine } from '@repo/global/src/types';
import { taskLine } from '@repo/global/src/taskLine';

export const getForm = (note): Config[] => [
  {
    dom: {
      type: DomType.input,
      defaultValue: null,
      placeholder: '请输入Github用户名',
      required: true,
    },
    label: '登录Github用户名',
    name: 'username',
    help: {
      description: '如何获取Github的账户？',
      url: 'https://github.com/signup?source=login',
    },
  },
  {
    dom: {
      type: DomType.input,
      defaultValue: null,
      rule: {
        pattern: /\w+/,
        message: '请输入正确Github密码',
        inputType: 'password',
      },
      placeholder: '请输入密码',
      required: true,
    },
    label: 'Github账户密码',
    name: 'password',
    help: {
      description: '忘记Github的密码？',
      url: 'https://github.com/password_reset',
    },
  },
  // {
  //   dom: {
  //     type: DomType.input,
  //     defaultValue: null,
  //     placeholder: '请输入用户名/组织名',
  //   },
  //   label: '需要将仓库放置的用户名或有权限的组织名',
  //   name: 'repoUser',
  //   help: {
  //     description:
  //       '一般放于个人仓库，不填默认使用登录用户名；也可以放于有权限的组织名下',
  //   },
  // },
  {
    dom: {
      type: DomType.input,
      defaultValue: 'CHENJI',
      rule: {
        pattern: /[a-zA-Z0-9]+/,
        message: '请输入正确英文/数字仓库名',
      },
      placeholder: '请输入仓库名（英文）',
    },
    label: '仓库名',
    name: 'repo',
  },
  {
    dom: {
      type: DomType.select,
      options: ['辰记发布'],
      defaultValue: '辰记发布',
    },
    label: '选择分类',
    name: 'category',
    help: {
      description:
        '博客的文章分类/category、存放目录，建议添加修改，默认为“辰记发布”',
    },
  },
  {
    dom: {
      type: DomType.input,
      defaultValue: note.title,
      placeholder: '请输入文件名',
      required: true,
    },
    label: '发布文件名',
    name: 'name',
    help: {
      description: '博客文章名、保存的文件名，默认使用笔记Title',
    },
  },
];

export const getTasks = ({
  form: { username, password, repo, category, name },
  note,
}: any) =>
  [
    {
      fnName: 'gotoUrl',
      params: {
        url: 'https://github.com/login',
      },
      info: '跳转登录页',
      msg: {
        process: 6,
        content: '跳转登录页成功，开始登录',
        fail: '跳转登录页失败，可能是网络错误需要VPN',
      },
    },
    {
      fnName: 'inputContent',
      params: {
        selector: '#login_field',
        content: username,
      },
      info: '输入用户名',
    },
    {
      fnName: 'inputContent',
      params: {
        selector: '#password',
        content: password,
      },
      info: '输入用户名',
    },
    {
      fnName: 'clickDom',
      params: {
        selector: 'input[type=submit]',
        willNavigation: true,
      },
      info: '点击登录',
      msg: {
        fail: '登录失败，请检查用户名或密码',
      },
    },
    {
      fnName: 'gotoUrl',
      params: {
        url: `https://github.com/star-note/CHENJI-Template/generate`,
      },
      info: '跳转新建仓库页面',
    },
    {
      fnName: 'inputContent',
      params: {
        selector: 'input[aria-label=Repository]',
        content: repo,
      },
      info: '输入仓库名',
    },
    {
      fnName: 'monitorResponse',
      params: {
        url: 'https://github.com/repositories/check-name',
        successTasks: [
          {
            fnName: 'clickDom',
            params: {
              selector: 'button[type=submit]',
              willNavigation: true,
            },
            info: '创建仓库成功',
          },
        ],
        failTasks: [
          {
            fnName: 'gotoUrl',
            params: {
              url: `https://github.com/${username}/${repo}`,
            },
            info: '仓库存在，跳转到仓库',
          },
        ],
      },
    },
    {
      fnName: 'gotoUrl',
      params: {
        url: `https://github.com/${user}/${repo}/edit/master/Notes笔记/${
          category ? `${category}/${name}` : name
        }`,
        selector: '#repo-content-pjax-container',
      },
      info: '编辑仓库文章',
      type: 'if',
      sub: {
        value: false,
        task: [
          {
            fnName: 'gotoUrl',
            params: {
              url: `https://github.com/${user}/${repo}/new/master/Notes笔记/${category}`,
            },
            info: '新建仓库文章',
          },
          {
            fnName: 'inputContent',
            params: {
              selector: 'input[name=filename]',
              content: name,
            },
            info: '输入仓库文章标题',
          },
        ],
      },
    },
    {
      fnName: 'inputContent',
      params: {
        selector: '.CodeMirror-code',
        content: JSON.stringify(note),
      },
      info: '输入笔记内容',
    },
    {
      fnName: 'clickDom',
      params: {
        selector: 'button[type=submit]',
        willNavigation: true,
      },
      info: '点击发布',
    },
  ] as Task[];


export const elecPublish = (page: TaskLine['page'], postProcess: TaskLine['postProcess'], payload: TaskLine['payload']) =>
  taskLine({
    page, postProcess, payload, getForm, getTasks,
    key: 'github',
  });
