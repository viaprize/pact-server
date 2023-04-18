import {
  BaseServiceV2,
  StandardOptions,
  ExpressRouter,
  Gauge,
  validators,
  waitForProvider,
} from '@eth-optimism/common-ts'
import { getChainId } from '@eth-optimism/core-utils'
import { Provider } from '@ethersproject/abstract-provider'
import { ethers, Transaction } from 'ethers'

import { Request, Response } from 'express';

import { version } from '../package.json'

type Options = {
  rpcProvider: Provider
  pactFactoryAddress: string
}

type Metrics = {
  blockTipNumber: Gauge
}

type State = {
  blockNumber: number
  db: DB
}

type Pact = {
  name: string
  terms: string
  address: string
  transactionHash: string
  blockHash: string
}

// In memory database, not real
class DB {
  private db: { [key: string]: Pact }

  constructor() {
    this.db = {}
  }

  async get(key: string): Promise<Pact> {
    return this.db[key]
  }

  async set(key: string, value: any): Promise<void> {
    this.db[key] = value
  }
}

export class Server extends BaseServiceV2<Options, Metrics, State> {
  constructor(options?: Partial<Options & StandardOptions>) {
    super({
      version,
      name: 'pact-server',
      loop: true,
      options: {
        loopIntervalMs: 2000,
        ...options,
      },
      optionsSpec: {
        rpcProvider: {
          validator: validators.provider,
          desc: 'HTTP URL for Ethereum RPC backend',
        },
        pactFactoryAddress: {
          validator: validators.str,
          desc: 'Address of the PactFactory contract',
        }
      },
      metricsSpec: {
        blockTipNumber: {
          type: Gauge,
          desc: 'Highest batch indices (checked and known)',
          labels: ['type'],
        },
      },
    })
  }

  async init(): Promise<void> {
    // Connect to L1.
    await waitForProvider(this.options.rpcProvider, {
      logger: this.logger,
      name: 'rpc-provider',
    })

    this.state.db = new DB()

    const chainId = await getChainId(this.options.rpcProvider)
    this.logger.info(`Pact factory address: ${this.options.pactFactoryAddress}`)
    this.logger.info(`Connected to chain: ${chainId}`)
  }

  // all routes have /api prefix automatically
  async routes(router: ExpressRouter): Promise<void> {
    router.get('/status', async (_, res: Response) => {
      return res.status(200).json({
        ok: true
      })
    })

    // Frontend sends transaction to chain, waits for receipt,
    // then posts to this endpoint so that the pact is saved
    // in the database. The frontend will have all of this information
    router.post('/pact', async (req: Request, res: Response) => {
      // TODO: validate each field on the body
      const pact: Pact = {
        name: req.body.name,
        terms: req.body.terms,
        address: req.body.address,
        transactionHash: req.body.transactionHash,
        blockHash: req.body.blockHash
      }

      // TODO: call out to the chain to ensure that this pact exists
      // the front end should only pass the transactionHash that
      // created the pact, and then the backend can get the transaction
      // receipt by hash and decode the `Create(address)` event to ensure
      // that the pact exists
      // The backend can also wait for the receipt so that the frontend doesn't
      // need to wait until the pact is created before it can be saved in the db

      await this.state.db.set(pact.address, pact)
      res.status(200).json()
    })

    router.get('/pact', async (req: Request, res: Response) => {
      const address = req.query.address as string
      const pact = await this.state.db.get(address)
      if (!pact) {
        res.status(404).json()
        return
      }
      res.status(200).json(pact)
    })
  }

  // This function is called on an interval. We should add logic for indexing pacts
  // that are created outside of the UI. The POST /api/pact endpoint should "connect"
  // the metadata to the pact
  async main(): Promise<void> {
    // look up in local db at latest synced height
    // look at remote chain to see if more blocks have been made
    // fetch all pact creation events in that block range
    // save all pacts to local db
    // when POST /api/pact, connect metadata in db to the generically indexed pact
  }
}

if (require.main === module) {
  const server = new Server()
  server.run()
}
