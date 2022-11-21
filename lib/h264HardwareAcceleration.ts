// ES6
import * as sdpTransform from 'sdp-transform';
import {getFakeMedia} from "getfakemedia";

interface GetSupportInfoResult{
    supportsH264: 'yes'|'no'|'unknown',
    supportsH264Hardware: 'yes'|'no'|'unknown'
    encoderImplementation: string
}

const getSupportInfo = async ()=>{
    const result:GetSupportInfoResult = {
        supportsH264: 'unknown',
        supportsH264Hardware: 'unknown',
        encoderImplementation: 'unknown'
    }
    const pcSend = new RTCPeerConnection()
    const pcRecv = new RTCPeerConnection()
    pcSend.onicecandidate = (evt)=>{
        if (evt.candidate){
            pcRecv.addIceCandidate(evt.candidate)
        }
    }
    const fakeMedia = getFakeMedia({video: true, audio: false})
    const videoTrack = fakeMedia.video?.track
    if (!videoTrack){
        return result
    }
    pcSend.addTrack(videoTrack)
    const offer1 = await pcSend.createOffer()
    if (!offer1.sdp) {
        return result
    }
    if (offer1.sdp.indexOf('H264') > -1){
        result.supportsH264 = 'yes'
    } else {
        result.supportsH264 = 'no'
    }
    const res = sdpTransform.parse(offer1.sdp)
    // console.log(JSON.stringify(res.media[0].rtp, null, 2))
    // console.log(JSON.stringify(res.media[0].fmtp, null, 2))
    // 在这里删除其他codec
    let H264CodecKeyword = '42001f'

    let H264PayloadToDelete: number[] = []
    let payloadsToDelete: number[] = []
    let hasProfileKeyword = false
    for (let i = res.media[0].fmtp.length - 1; i >= 0; i--){
        if (res.media[0].fmtp[i].config.indexOf('profile-level-id') !== -1){
            if (res.media[0].fmtp[i].config.indexOf(H264CodecKeyword) === -1){
                H264PayloadToDelete.push(res.media[0].fmtp[i].payload)
            } else {
                hasProfileKeyword = true
            }
        }
    }
    for (let i = res.media[0].rtp.length - 1; i >= 0; i--){
        if (['VP8', 'VP9', 'AV1'].indexOf(res.media[0].rtp[i].codec) !== -1 ||
            (hasProfileKeyword && H264PayloadToDelete.indexOf(res.media[0].rtp[i].payload) !== -1)){
            payloadsToDelete.push(res.media[0].rtp[i].payload)
            payloadsToDelete.push(res.media[0].rtp[i + 1].payload)
            res.media[0].rtp.splice(i, 2)
        }
    }
    let payloadArr = res.media[0].payloads?.split(' ')
    if (payloadArr){
        payloadArr = payloadArr.filter((payloadId)=>{
            return payloadsToDelete.indexOf(parseInt(payloadId)) === -1
        })
        res.media[0].payloads = payloadArr.join(' ')
    }
    for (let i = res.media[0].fmtp.length - 1; i >= 0; i--){
        if (payloadsToDelete.indexOf(res.media[0].fmtp[i].payload) !== -1){
            res.media[0].fmtp.splice(i, 1)
        }
    }
    if (res.media[0].rtcpFb){
        for (let i = res.media[0].rtcpFb.length - 1; i >= 0; i--){
            if (payloadsToDelete.indexOf(res.media[0].rtcpFb[i].payload) !== -1){
                res.media[0].rtcpFb.splice(i, 1)
            }
        }
    }

    // console.log('res', res)
    const sdp = sdpTransform.write(res)
    const offer2 = new RTCSessionDescription({
        type: 'offer',
        sdp: sdp
    })
    await pcSend.setLocalDescription(offer2)
    await pcRecv.setRemoteDescription(offer2)
    const answer = await pcRecv.createAnswer()
    await pcRecv.setLocalDescription(answer)
    await pcSend.setRemoteDescription(answer)
    let lastStats: RTCStatsReport|null = null
    for (let i = 0; i < 100; i++){
        await new Promise((res)=>{
            setTimeout(res, 10)
        })
        const stats = await pcSend.getStats(null)
        lastStats = stats
        stats.forEach((report)=>{
            if (report.encoderImplementation && report.encoderImplementation !== 'unknown'){
                result.encoderImplementation = report.encoderImplementation
            }
        })
        if (result.encoderImplementation !== 'unknown'){
            break
        }
    }
    // lastStats && lastStats.forEach((report)=>{
    //     if (report.encoderImplementation && report.encoderImplementation !== 'unknown'){
    //         result.encoderImplementation = report.encoderImplementation
    //     }
    //     Object.keys(report).forEach((key)=>{
    //         console.log(key, report[key])
    //     })
    // })
    if (result.encoderImplementation === 'OpenH264') {
        result.supportsH264Hardware = 'no'
    } else if (result.encoderImplementation !== 'unknown') {
        result.supportsH264Hardware = 'yes'
    }
    videoTrack.stop()
    pcSend.close()
    pcRecv.close()
    return result
}

const main = async ()=>{
    const info = await getSupportInfo()
    document.body.innerHTML = `<h1><pre>${JSON.stringify(info, null, 2)}</pre></h1>`
}

main()

