import balenaSdk from 'balena-sdk'
const balena = balenaSdk.fromSharedOptions()
import iotApi from '@google-cloud/iot'
import crypto from 'crypto'
import util from 'util'

const generateKeyPair = util.promisify(crypto.generateKeyPair)
// GCP IoT Client
let iot = null
// Path string to IoT Core registry (project, region, registry) required for IoT functions
let registryPath = ''

/**
 * Provides create and deletion of GCP IoT Core device and updates balena GCP_PRIVATE_KEY
 * environment var. Uses POST request to create and DELETE to delete. Expects request
 * body with JSON containing {uuid: <device-uuid>}.
 */
export async function provision(req, res) {
    try {
        const creds =  { email: process.env.RESIN_EMAIL, password: process.env.RESIN_PASSWORD }
        await balena.auth.login(creds)

        // Validate device with balenaCloud
        await balena.models.device.get(req.body.uuid)

        // Initialize globals for GCP IoT data
        iot = new iotApi.v1.DeviceManagerClient({
            projectId: process.env.PROJECT_ID,
            credentials: JSON.parse(Buffer.from(process.env.GCP_SERVICE_ACCOUNT, 'base64').toString())
        })
        registryPath = iot.registryPath(process.env.GCP_PROJECT_ID, process.env.GCP_REGION,
            process.env.GCP_REGISTRY_ID)

        switch (req.method) {
            case 'POST':
                console.log("Creating device...")
                await handlePost(req, res, )
                break
            case 'DELETE':
                console.log("Deleting device...")
                await handleDelete(req, res)
                break
            default:
                throw "method not handled"
        }
    } catch (error) {
        console.log("Error: ", error)
        if (error.code === balena.errors.BalenaDeviceNotFound.prototype.code
                || error.code === balena.errors.BalenaInvalidLoginCredentials.prototype.code) {
            res.status(400)
        } else {
            res.status(500)
        }
        res.send(error)
    }
}

/**
 * Adds device to GCP IoT registry with new key pair, and adds balena device environment
 * var for the private key.
 *
 * Throws an error on failure to create the device.
 */
async function handlePost(req, res) {
    // generate key pair; we only need the private key 
    const keyPair = await generateKeyPair('ec', {namedCurve: 'prime256v1',
        privateKeyEncoding: { type: 'pkcs8', format: 'pem'},
        publicKeyEncoding: { type: 'spki', format: 'pem' }
    })

    const deviceId = `balena-${req.body.uuid}`
    const device = {
        id: deviceId,
        credentials: [{ publicKey: { format: 'ES256_PEM', key: keyPair.publicKey } }]
    }
    await iot.createDevice({ parent: registryPath, device: device })

    await balena.models.device.envVar.set(req.body.uuid, 'GCP_PRIVATE_KEY',
            Buffer.from(keyPair.privateKey).toString('base64'))
    await balena.models.device.envVar.set(req.body.uuid, 'GCP_CLIENT_PATH',
            `${registryPath}/devices/${deviceId}`)
    await balena.models.device.envVar.set(req.body.uuid, 'GCP_DATA_TOPIC_ROOT',
            `/devices/${deviceId}`)
    await balena.models.device.envVar.set(req.body.uuid, 'GCP_PROJECT_ID',
            process.env.GCP_PROJECT_ID)

    console.log(`Created device ${deviceId}`)
    res.status(201).send("device created")
}

/**
 * Removes device from GCP IoT registry and balena device environment var.
 */
async function handleDelete(req, res) {
    const deviceId = `balena-${req.body.uuid}`
    await iot.deleteDevice({ name: `${registryPath}/devices/${deviceId}` })

    await balena.models.device.envVar.remove(req.body.uuid, 'GCP_PRIVATE_KEY')
    await balena.models.device.envVar.remove(req.body.uuid, 'GCP_CLIENT_PATH')
    await balena.models.device.envVar.remove(req.body.uuid, 'GCP_DATA_TOPIC_ROOT')
    await balena.models.device.envVar.remove(req.body.uuid, 'GCP_PROJECT_ID')

    console.log(`Deleted device ${deviceId}`)
    res.status(200).send("device deleted")
}
