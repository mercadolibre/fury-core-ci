const core = require('@actions/core');
const Github = require('@actions/github');
import * as Webhooks from '@octokit/webhooks'
// const Webhooks = require("@octokit/webhooks");

const semver = require('semver')

const patchRegex = /fix\/*/
const minorRegex = /feature\/*/
const majorRegex = /release\/*/

// most @actions toolkit packages have async methods
async function run() {
    try {
        const token = process.env['GITHUB_TOKEN']
        const octokit = new Github.GitHub(token);
        const {owner, repo} = Github.context.repo

        let prerelease = false
        let branch = ''
        // if (Github.context.eventName === 'push') {
        //     branch = Github.context.ref.replace('refs/heads/', '')
        //     if(branch !== 'master'){
        //         core.info('push not to master, skipping')
        //         return
        //     }
        //     // const pushPayload = Github.context.payload as Webhooks.WebhookPayloadPush
        //     // pushPayload.base_ref
        // }

        if (Github.context.eventName === 'pull_request') {
            prerelease = true
            const prPayload = Github.context.payload as Webhooks.WebhookPayloadPullRequest
            if (prPayload.pull_request.base.ref !== 'master') {
                core.info('PR not to master, skipping')
                return
            }
            if (prPayload.pull_request.draft) {
                core.info('PR is a draft, skipping')
                return
            }
            if (!['opened', 'edited', 'ready_for_review', 'synchronize'].includes(prPayload.action)) {
                core.info('PR action not supported, skipping')
                return
            }
            // PR merged:
            if (prPayload.action === 'closed' && prPayload.pull_request.merged) {
                prerelease = false
            }

            branch = prPayload.pull_request.head.ref
            // prPayload.pull_request.body
        }

        // Define tag and release name
        let bump = ''
        const prefix = prerelease ? 'pre' : ''
        switch (true) {
            case patchRegex.test(branch):
                bump = `${prefix}patch`
                break
            case minorRegex.test(branch):
                bump = `${prefix}minor`
                break
            case majorRegex.test(branch):
                bump = `${prefix}major`
                break
            case branch === 'v1':// todo remove
                bump = `${prefix}minor`
                break
            default:
                core.warning('branch name not expected, skipping')
                return
        }
        const tags = await octokit.repos.listTags({
            owner,
            repo,
            per_page: 100
        });

        let newTag = ""
        const fullReleases = tags.data.filter(tag => !semver.prerelease(tag.name))
        const firstValid = fullReleases.find(tag => semver.valid(tag.name))
        let lastTag = firstValid.name
        if (prerelease) {
            const rcName = `rc-${branch.replace('/', '-')}`
            const rcs = tags.data.filter(tag => tag.name.includes(rcName))
            console.log(rcName)
            console.log(rcs)
            if (rcs.length !== 0) {
                // increase RC number
                newTag = semver.inc(rcs[0], 'prerelease')
            } else {
                // create RC
                newTag = semver.inc(lastTag, bump, rcName)
            }
        } else {
            newTag = semver.inc(lastTag, bump)
        }
        const releaseName = ""//todo
        console.log(lastTag)
        console.log(newTag)

        // const createReleaseResponse = await octokit.repos.createRelease({
        //     owner,
        //     repo,
        //     tag_name: newTag,
        //     name: releaseName,
        //     body: '',
        //     draft: false,
        //     prerelease
        // });
        // // Get the ID, html_url, and upload URL for the created Release from the response
        // const {
        //     data: {id: releaseId, html_url: htmlUrl, upload_url: uploadUrl}
        // } = createReleaseResponse;
        //
        // // Set the output variables for use by other actions: https://github.com/actions/toolkit/tree/master/packages/core#inputsoutputs
        // core.setOutput('id', releaseId);
        // core.setOutput('html_url', htmlUrl);
        // core.setOutput('upload_url', uploadUrl);
    } catch (error) {
        core.setFailed(error.message);
    }
}

run()
