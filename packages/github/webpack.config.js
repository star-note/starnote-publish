/* eslint-disable */
const path = require('path');
const webpack = require('webpack');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const loaders = [
  {
    test: /\.jsx?$/,
    exclude: /(node_modules)/,
    use: {
      loader: 'babel-loader',
      options: {
        presets: ['@babel/preset-env']
      }
    }
  },
  {
    test: /\.tsx?$/,
    exclude: /node_modules/,
    loader: 'babel-loader',
    options: {
      presets: ['@babel/preset-env', '@babel/preset-typescript']
    }
  } // 先解析ts和tsx，rule规则从下往上
];

const config = {
  resolve: {
    extensions: ['.ts', '.js'],
  },
  entry: path.join(__dirname, './src/index.ts'),
  output: {
    path: path.join(__dirname, './dist'),
    filename: 'publish.min.js',
    // library: 'StarNotePublish',
    libraryTarget: 'umd',
    umdNamedDefine: true,
  },

  module: {
    rules: loaders,
  },

  mode: 'production',
  devtool: 'cheap-module-source-map',

  plugins: [
    new CleanWebpackPlugin({
      cleanAfterEveryBuildPatterns: ['dist'],
    }),
    new webpack.optimize.AggressiveMergingPlugin(),
  ],

  performance: {
    maxAssetSize: 1000000,
    hints: 'warning',
  }
};

module.exports = config;
