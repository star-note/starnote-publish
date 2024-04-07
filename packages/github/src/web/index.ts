import { Octokit } from '@octokit/rest';
import { encode, decode } from 'js-base64';
import { checkParams, getTimeStr, sleep } from '@repo/global/src/utils';
import { Config, DomType, Message } from '@repo/global/src/types';

export const getForm = (note): Config[] => [
  {
    dom: {
      type: DomType.input,
      defaultValue: null,
      rule: {
        pattern: /\w+/,
        message: '请输入正确access-token',
        inputType: 'password',
      },
      placeholder: '请输入Github access-token',
      required: true,
    },
    label: 'access-token',
    name: 'accessToken',
    help: {
      description: '如何获取Github的个人access-token？',
      url: 'https://docs.github.com/cn/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token',
    },
  },
  {
    dom: {
      type: DomType.input,
      defaultValue: null,
      // rule: /\w+/,
      placeholder: '请输入Github用户名',
      required: true,
    },
    label: 'Github用户名/owner',
    name: 'owner',
    help: {
      description: '没有用户？创建一个',
      url: 'https://www.github.com/',
    },
  },
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
      // rule: {
      //   pattern: /\w+/,
      //   message: '请输入正确文件名',
      // },
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

export interface Options {
  form: {
    accessToken: string;
    owner: string;
    repo: string;
    category: string;
    name: string;
  };
  note: any;
  source?: {
    homeUrl: string;
    logo: string;
    desc?: string;
    title?: string;
  };
  user?: {
    nickName: string;
    id: string;
    avatarUrl?: string;
  };
}
export const publish = async (
  options: Options,
  postProcess: (msg: Message) => void
) => {
  console.log('web publish start');
  const { form, note, source, user } = options || {};
  const { accessToken, owner, repo, category, name } = form;
  const formConfigs = getForm(note);
  postProcess({
    time: new Date().getTime(),
    process: 1,
    content: `辰记笔记发布Github开始，发布标题《${name}》`,
    status: 'publishing',
  });
  // 校验参数
  if (!checkParams(form, formConfigs)) {
    console.log('参数校验失败');
    postProcess({
      time: new Date().getTime(),
      process: 100,
      content: '参数预校验失败，请检查配置参数或上报错误',
      status: 'fail',
    });
    return;
  }
  if (!note) {
    postProcess({
      time: new Date().getTime(),
      process: 100,
      content: '发布内容为空，请检查笔记内容或接入情况',
      status: 'fail',
    });
    return;
  }

  postProcess({
    time: new Date().getTime(),
    process: 10,
    content: '参数校验成功',
  });
  const github = new Octokit({
    auth: accessToken,
  });

  try {
    const repos = await github.request('GET /users/{owner}/repos', {
      owner,
    });
    console.log(repos);
    postProcess({
      time: new Date().getTime(),
      process: 20,
      content: '获取用户仓库成功',
    });

    // 仓库不存在就从模板新建仓库
    if (
      !(
        Array.isArray(repos.data) &&
        repos.data.filter(item => item.name === repo).length === 1
      )
    ) {
      await github.rest.repos.createUsingTemplate({
        template_owner: 'star-note',
        template_repo: 'CHENJI-Template',
        name: repo,
        description: '辰记发布', // TODO
      });
      postProcess({
        time: new Date().getTime(),
        process: 50,
        content: `新建仓库"${repo}"成功`,
      });
      await github.rest.repos.createPagesSite({
        owner,
        repo,
        'source.branch': 'main',
      })
      postProcess({
        time: new Date().getTime(),
        process: 55,
        content: `新增仓库主页成功`,
      });
    }
    await sleep(1000); // 有时候建立仓库成功后，写入失败（测试出现在频繁删除仓库又重建的情况）
    postProcess({
      time: new Date().getTime(),
      process: 60,
      content: '准备写入数据',
    });

    // 更新文件公共函数：先判断是否原文件存在，不存在新建，存在需拿到原文件的sha值再进行更新
    const updateFile = async (
      path: string,
      content: string,
      keepOriContent = false,
      successCB,
      failCB?
    ) => {
      const result = await github.rest.repos
        .getContent({
          owner,
          repo,
          path,
        })
        .then(resp =>
          !Array.isArray(resp) && !Array.isArray(resp.data)
            ? {
                sha: resp.data.sha,
                // @ts-ignore
                oriContent: resp.data?.content,
              }
            : undefined
        )
        .catch(e => {
          console.log('获取文件错误：', e);
        })
        .then(data => {
          const { sha, oriContent } = data || {};
          console.log(sha);
          return github.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path, // 笔记发布路径
            message: `辰记自动化发布-${note.noteId}-${name}`, // 本次发布message
            content: encode(
              keepOriContent ? `${decode(oriContent)}\n${content}` : content
            ), // 内容必须base64
            ...(sha ? { sha } : null),
          });
        })
        .then(data => {
          if (successCB) successCB(data.data.content.html_url);
          return data.data.content.html_url;
        })
        .catch(e => {
          console.log('新增/更新文件错误：', e);
          if (failCB) failCB();
          throw new Error(e); // 更新报错抛出，使调用方可以中断
        });

      return result;
    };

    const publicPath = `Notes笔记/${category ? `${category}/` : ''}`;
    // 发布 github 笔记
    await updateFile(
      `${publicPath}${name}.md`,
      note.html,
      false,
      url => {
        postProcess({
          time: new Date().getTime(),
          content: `发布 ${publicPath}${name} 成功，点击查看发布地址`,
          process: 70,
          link: url,
          type: 'url',
        });
      },
      () => {
        postProcess({
          time: new Date().getTime(),
          status: 'fail',
          process: 100,
          content: 'access_token权限不足，请参照示例重新生成有权限access_token',
          link: '',
          type: 'url',
        });
      }
    );

    const staticPath = 'static/data/';
    // 发布 github page 需要的 layout 数据
    await updateFile(
      `${staticPath}layout.js`,
      `
    /***** 发布时间：${getTimeStr()}（以最后发布的为准）*****/
    layout.homeUrl='${source.homeUrl}';
    layout.logo='${source.logo}';
    layout.githubUrl='https://github.com/${owner}/${repo}';
    `,
      true,
      url => {
        postProcess({
          time: new Date().getTime(),
          content: `发布 ${staticPath}layout.js 成功，点击查看发布地址`,
          process: 80,
          link: url,
          type: 'url',
        });
      }
    );
    // 发布 github page 需要的 dataSource 数据
    await updateFile(
      `${staticPath}dataSource.js`,
      `
    /***** 发布时间：${getTimeStr()}（以最后发布的为准）*****/
    dataSource['CHENJI-Temple']=undefined;
    dataSource['CHENJI-Temple2']=undefined;
    var pub = {
      title: '${note.title}',
      content: \`${note.html}\`,
      publishTime: '${getTimeStr()}',
      category: '${category}',
      noteId: '${note.noteId}'
    };
    if(dataSource['${category}']) {
      const note = dataSource['${category}'].filter(function(item){ return item.noteId === '${
        note.noteId
      }'});
      if(note && note.length > 0) {
        note[0].title=pub.title;
        note[0].content=pub.content;
        note[0].publishTime=pub.publishTime;
      } else {
        dataSource['${category}'].push(pub);
      }
    }else{
      dataSource['${category}']=[pub];
    }
    `,
      true,
      (url) => {
        postProcess({
          time: new Date().getTime(),
          status: 'success',
          content: `发布 ${staticPath}dataSource.js 成功，点击查看发布地址`,
          process: 100,
          link: url,
          type: 'url',
        });
      }
    );
  } catch (e) {
    console.log('发布错误：', e);
    if (e.code === 500) {
      postProcess({
        time: new Date().getTime(),
        status: 'fail',
        content: '网络错误，请检查网络或需要VPN',
      });
    } else {
      // 区分code，401为auth错误
      postProcess({
        time: new Date().getTime(),
        status: 'fail',
        content: '用户名或access-token错误或已过期',
      });
    }
  }
};
