import balenaSdk from 'balena-sdk'
const balena = balenaSdk.fromSharedOptions()
import iotApi from '@google-cloud/iot'
import crypto from 'crypto'
import util from 'util'

const generateKeyPair = util.promisify(crypto.generateKeyPair)

export async function provision(req, res) {
    try {
        const uuid = req.body.uuid
        const creds =  { email: process.env.RESIN_EMAIL, password: process.env.RESIN_PASSWORD }

        await balena.auth.login(creds)

        // Validate device with balenaCloud
        if (! await balena.models.device.get(uuid)) {
            res.status(400).send("device not valid")
            return
        }

        // generate key pair; we only need the private key 
        const keyPair = await generateKeyPair('ec', {namedCurve: 'prime256v1',
            privateKeyEncoding: { type: 'pkcs8', format: 'pem'},
            publicKeyEncoding: { type: 'spki', format: 'pem' }
        })

        // create GCP IoT device
        let iot = new iotApi.v1.DeviceManagerClient({
            projectId: process.env.PROJECT_ID,
            credentials: JSON.parse(Buffer.from(process.env.GCP_SERVICE_ACCOUNT, 'base64').toString())
        })

        const path = iot.registryPath(process.env.GCP_PROJECT_ID, process.env.GCP_REGION,
                process.env.GCP_REGISTRY_ID)
        let device = {
            id: `balena-${uuid}`,
            credentials: [{ publicKey: { format: 'ES256_PEM', key: keyPair.publicKey } }]
        }
        await iot.createDevice({ parent: path, device: device })

        // set balena device variable for the private key
        await balena.models.device.envVar.set(uuid, 'GCP_PRIVATE_KEY',
                Buffer.from(keyPair.privateKey).toString('base64'))

        res.status(200).send("device valid")

    } catch (error) {
        console.log("Error: ", error)
        res.status(500).send(error)
    }
}
