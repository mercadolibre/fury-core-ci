FROM gcr.io/kaniko-project/executor:debug AS kaniko

FROM bash:latest

RUN apk add --no-cache curl git jq openssh

# Create kaniko directory with world write permission to allow non root run
RUN ["sh", "-c", "mkdir -p /kaniko && chmod 777 /kaniko"]

COPY --from=kaniko /kaniko/ /kaniko/
COPY --from=kaniko /etc/nsswitch.conf /etc/nsswitch.conf

ENV HOME /root
ENV USER root
ENV PATH="${PATH}:/kaniko"
ENV SSL_CERT_DIR=/kaniko/ssl/certs
ENV DOCKER_CONFIG /kaniko/.docker/
ENV DOCKER_CREDENTIAL_GCR_CONFIG /kaniko/.config/gcloud/docker_credential_gcr_config.json

WORKDIR /workspace

ENTRYPOINT ["/kaniko/executor"]