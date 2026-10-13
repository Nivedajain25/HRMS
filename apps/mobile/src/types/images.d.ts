/** Bundled images (`import logo from '…/logo.png'`): Metro turns each into a numeric asset id for <Image source>. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
