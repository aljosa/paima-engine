export const enum AddressType {
  UNKNOWN = 0,
  EVM = 1,
  CARDANO = 2,
  POLKADOT = 3,
  ALGORAND = 4,
}

export const DEFAULT_FUNNEL_TIMEOUT = 5000;

export const enum ChainDataExtensionType {
  UNKNOWN = 0,
  ERC20 = 1,
  ERC721 = 2,
  PaimaERC721 = 3,
  ERC20Deposit = 4,
  Generic = 5,
}

export const enum ChainDataExtensionDatumType {
  ERC20Transfer,
  ERC20Deposit,
  ERC721Mint,
  ERC721Transfer,
  Generic,
}
