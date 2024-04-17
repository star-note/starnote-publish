# starnote发布SDK的monorepo仓库

使用monorepo理念管理所有发布SDK。使用turbo一个命令打包所有SDK，加快打包速度。使用changeset管理每个npm包的发布及changelog。

### 开始
1. 安装依赖
```bash
pnpm
```
node >=18，推荐使用pnpm，全局安装

2. 打包
```bash
pnpm build
```

3. publish包
```bash
# 选择changed的packages，要按 空格键 选择！！！
pnpm changeset

# 选择版本类型 → 输入更新摘要 → 确定生成 changeset 文件
pnpm version-packages

# 生产包自动publish到开源npmjs
pnpm release
```
