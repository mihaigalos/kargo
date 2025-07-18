import { useQuery } from '@tanstack/react-query';
import { Button, notification } from 'antd';
import {
  discoveryRequest,
  processDiscoveryResponse,
  generateRandomCodeVerifier,
  generateRandomState,
  calculatePKCECodeChallenge,
  validateAuthResponse,
  authorizationCodeGrantRequest,
  processAuthorizationCodeResponse,
  AuthorizationResponseError,
  WWWAuthenticateChallengeError,
  allowInsecureRequests
} from 'oauth4webapi';
import React from 'react';
import { useLocation } from 'react-router-dom';

import { OIDCConfig } from '@ui/gen/api/service/v1alpha1/service_pb';

import { useAuthContext } from './context/use-auth-context';
import {
  getOIDCScopes,
  oidcClientAuth,
  shouldAllowIdpHttpRequest as shouldAllowHttpRequest
} from './oidc-utils';

const codeVerifierKey = 'PKCE_code_verifier';
const stateKey = 'PKCE_state';

type Props = {
  oidcConfig: OIDCConfig;
};

export const OIDCLogin = ({ oidcConfig }: Props) => {
  const location = useLocation();
  const redirectURI = window.location.origin + window.location.pathname;
  const { login: onLogin } = useAuthContext();

  const issuerUrl = React.useMemo(() => {
    try {
      return new URL(oidcConfig.issuerUrl);
    } catch (_) {
      notification.error({
        message: 'Invalid issuerURL',
        placement: 'bottomRight'
      });
    }
  }, [oidcConfig.issuerUrl]);

  const client = React.useMemo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => ({ client_id: oidcConfig.clientId, token_endpoint_auth_method: 'none' as any }),
    [oidcConfig]
  );

  const {
    data: as,
    isFetching,
    error
  } = useQuery({
    queryKey: [issuerUrl],
    queryFn: () =>
      issuerUrl &&
      discoveryRequest(issuerUrl, {
        [allowInsecureRequests]: shouldAllowHttpRequest()
      }).then((response) => processDiscoveryResponse(issuerUrl, response)),
    enabled: !!issuerUrl
  });

  React.useEffect(() => {
    if (error) {
      const errorMessage = error instanceof Error ? error.message : 'OIDC config fetch error';
      notification.error({ message: `OIDC: ${errorMessage}`, placement: 'bottomRight' });
    }
  }, [error]);

  const login = async () => {
    if (!as?.authorization_endpoint) {
      return;
    }

    const code_verifier = generateRandomCodeVerifier();
    sessionStorage.setItem(codeVerifierKey, code_verifier);
    const state = generateRandomState();
    sessionStorage.setItem(stateKey, state);

    const code_challenge = await calculatePKCECodeChallenge(code_verifier);
    const url = new URL(as.authorization_endpoint);
    url.searchParams.set('client_id', client.client_id);
    url.searchParams.set('code_challenge', code_challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('redirect_uri', redirectURI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', getOIDCScopes(oidcConfig, as).join(' '));
    url.searchParams.set('state', state);

    window.location.replace(url.toString());
  };

  // Handle callback from OIDC provider
  React.useEffect(() => {
    (async () => {
      const code_verifier = sessionStorage.getItem(codeVerifierKey);
      const state = sessionStorage.getItem(stateKey);
      const searchParams = new URLSearchParams(location.search);

      if (
        !as ||
        !code_verifier ||
        !searchParams.get('code') ||
        !state ||
        !searchParams.get('state')
      ) {
        return;
      }

      try {
        const params = validateAuthResponse(as, client, searchParams, state);

        const response = await authorizationCodeGrantRequest(
          as,
          client,
          oidcClientAuth,
          params,
          redirectURI,
          code_verifier,
          {
            [allowInsecureRequests]: shouldAllowHttpRequest(),
            additionalParameters: [['client_id', client.client_id]]
          }
        );

        const result = await processAuthorizationCodeResponse(as, client, response, {
          requireIdToken: true
        });

        if (!result.id_token) {
          notification.error({
            message: 'OIDC: Proccess Authorization Code Grant Response error',
            placement: 'bottomRight'
          });
          return;
        }

        onLogin(result.id_token, result.refresh_token);
      } catch (err) {
        if (err instanceof AuthorizationResponseError) {
          notification.error({
            message: 'OIDC: Validation Auth Response error',
            placement: 'bottomRight'
          });
          return;
        }

        if (err instanceof WWWAuthenticateChallengeError) {
          notification.error({
            message: 'OIDC: Parsing Authenticate Challenges error',
            placement: 'bottomRight'
          });
          return;
        }

        notification.error({
          message: `OIDC: ${JSON.stringify(err)}`,
          placement: 'bottomRight'
        });
      }
    })();
  }, [as, client, location]);

  return (
    <Button onClick={login} block size='large' loading={isFetching} disabled={!issuerUrl}>
      SSO Login
    </Button>
  );
};
