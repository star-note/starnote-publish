# @starnote/publish-github 辰记发布Github SDK



### 开发须知
|- src

​	|- index.ts 全局配置文件，发布主要读这个文件导出的变量，如$publish_github（在window上）

​	|- electron 给桌面版提供的发布SDK

​	|- node 给server端提供的发布SDK，目前不推荐

​	|- web 给浏览器端提供的发布SDK，优先级最高



新的发布平台应该复制github的文件夹，改动上面4个文件的实现。



### 打包、发布
依托于母项目：使用monorepo理念管理所有发布SDK。使用turbo一个命令打包所有SDK，加快打包速度。使用changeset管理每个npm包的发布及changelog。

打包、发布命令需要在母项目中，参考readme执行。

母项目URL在package.json中。


